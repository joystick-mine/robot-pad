/* 펌웨어 설치 — 레고 공식 펌웨어를 Pybricks 펌웨어(4.1.1)로 바꿔요.
 * Pybricks Code(MIT 라이선스)의 설치 방식을 그대로 옮겼어요.
 *  - 스파이크 프라임: USB DFU (WebUSB) — Pybricks 공식 설치 도구(MIT)의 순서를 따라요
 *  - EV3: 펌웨어 업데이트 모드 (WebHID)
 */
(function () {
  "use strict";
  const PBW = (window.PBW = window.PBW || {});
  const LEGO_VID = 0x0694;
  const PID = { primeDfu: 0x0008, inventorDfu: 0x0011, ev3Boot: 0x0006 };

  async function loadFile(name) {
    const r = await fetch("fw/" + name);
    if (!r.ok) throw new Error("펌웨어 파일(" + name + ")을 불러오지 못했어요");
    return r;
  }

  // 허브 이름 넣기 (UTF-8 + 끝 표시 0, 크기 제한)
  function encodeName(name, size) {
    const bytes = new TextEncoder().encode(name + "\0");
    if (bytes.length > size) throw new Error(`이름이 너무 길어요. 영어 ${size - 1}자, 한글 ${Math.floor((size - 1) / 3)}자까지 돼요.`);
    return bytes;
  }
  PBW.nameFits = (name) => { try { encodeName(name, 16); return true; } catch (e) { return false; } };

  async function buildFirmware(binName, metaName, platform, hubName) {
    const meta = await (await loadFile(metaName)).json();
    const variant = meta.variants ? meta.variants.find((v) => v.platform === platform) || meta.variants[0] : meta;
    const base = new Uint8Array(await (await loadFile(binName)).arrayBuffer());
    if (variant["checksum-type"] !== "none") throw new Error("이 펌웨어 형식은 아직 지원하지 않아요");
    // EV3: 마지막 조각 크기 문제를 피하려고 Pybricks Code처럼 길이를 맞춰요
    let extra = 0;
    if (meta["device-id"] === 226) {
      const rem = base.length % (2 * 64 * 1024);
      if (rem) extra = 1018 - (rem % 1018);
    }
    const fw = new Uint8Array(base.length + extra);
    fw.set(base);
    if (hubName) fw.set(encodeName(hubName, variant["hub-name-size"]), variant["hub-name-offset"]);
    return { firmware: fw, version: String(meta["firmware-version"]).replace(/^.*-v/, "v") };
  }

  /* ---------- 스파이크 프라임 (USB DFU) ----------
   * Pybricks 4.x 펌웨어는 0x08010000에서 시작해요 (앞 64KB = 레고 기본 부트로더 32KB + 2단계 부트로더 32KB).
   * 3.x 시절 Pybricks Code처럼 0x08008000에 쓰면 허브가 켜지지 않아요.
   * 그래서 Pybricks 공식 설치 도구(pybricks-micropython/tools/flash/dfu.py)의 순서를 그대로 따라요.
   *  - 기본 부트로더(bcdDevice 0x0100, F4): 2단계 부트로더(mboot.bin)가 있어야 해요 → 없으면 공식 사이트 안내
   *  - 2단계 부트로더가 있는 F4(0x0300, 64K/128K 섹터): 0x08010000에 바로 설치
   *  - 새 허브 H5(0x0300, 8K 섹터): 0x08010000에 바로 설치 (H5 순서대로)
   * 머리(시작 주소 부분)는 맨 마지막에 써서, 중간에 케이블이 빠지면 허브가 다시 업데이트 모드로 켜지게 해요.
   */
  const FLASH_BASE = 0x08000000, KB = 1024, FW_ADDR = FLASH_BASE + 64 * KB;
  const ST = { IDLE: 2, DNBUSY: 4, DNIDLE: 5, MANIFEST: 7, UPIDLE: 9 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SECTORS = {
    f4: (() => { const out = []; let a = FLASH_BASE; for (const k of [16, 16, 16, 16, 64, 128, 128, 128, 128, 128, 128, 128]) { out.push([a, k * KB]); a += k * KB; } return out; })(),
    h5: Array.from({ length: 128 }, (_, i) => [FLASH_BASE + i * 8 * KB, 8 * KB]),
  };
  const OFFICIAL = "https://code.pybricks.com";

  class Dfu {
    constructor(dev) { this.dev = dev; this.xfer = 1024; this.layout = ""; this.mcu = null; }
    async open() {
      const d = this.dev;
      if (!d.opened) await d.open();
      if (!d.configuration) await d.selectConfiguration(1);
      await d.claimInterface(0);
      try { await d.selectAlternateInterface(0, 0); } catch (e) {}
      // 설정 설명서에서 한 번에 보낼 크기(wTransferSize)와 메모리 배치 글자 번호를 찾아요
      const cfg = await this.configDescriptor();
      let strIdx = 0;
      for (let i = 0; i + 1 < cfg.length && cfg[i]; i += cfg[i]) {
        const len = cfg[i], type = cfg[i + 1];
        if (type === 4 && cfg[i + 2] === 0 && cfg[i + 3] === 0) strIdx = cfg[i + 8];
        if (type === 0x21 && len >= 7) this.xfer = cfg[i + 5] | (cfg[i + 6] << 8) || 1024;
      }
      const alt = d.configuration.interfaces[0] && d.configuration.interfaces[0].alternates.find((a) => a.alternateSetting === 0);
      this.layout = (alt && alt.interfaceName) || (await this.string(strIdx));
      for (let k = 0; k < 4; k++) {   // 대기 상태로 맞춰요
        const [s] = await this.status();
        if (s === ST.IDLE) break;
        await this.out(s === ST.DNIDLE || s === ST.UPIDLE ? 6 /*ABORT*/ : 4 /*CLRSTATUS*/, 0);
      }
    }
    async configDescriptor() {
      const req = { requestType: "standard", recipient: "device", request: 6, value: 0x0200, index: 0 };
      let r = await this.dev.controlTransferIn(req, 9);
      r = await this.dev.controlTransferIn(req, r.data.getUint16(2, true));
      return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    }
    async string(idx) {
      if (!idx) return "";
      try {
        const r = await this.dev.controlTransferIn({ requestType: "standard", recipient: "device", request: 6, value: 0x0300 | idx, index: 0x0409 }, 255);
        let s = ""; for (let i = 2; i + 1 < Math.min(r.data.getUint8(0), r.data.byteLength); i += 2) s += String.fromCharCode(r.data.getUint16(i, true));
        return s;
      } catch (e) { return ""; }
    }
    async out(request, value, data) {
      const r = await this.dev.controlTransferOut({ requestType: "class", recipient: "interface", request, value, index: 0 }, data);
      if (r.status !== "ok") throw new Error("USB 전송 실패 (" + r.status + ")");
    }
    async status() {
      const r = await this.dev.controlTransferIn({ requestType: "class", recipient: "interface", request: 3, value: 0, index: 0 }, 6);
      const d = r.data;
      return [d.getUint8(4), d.getUint8(1) | (d.getUint8(2) << 8) | (d.getUint8(3) << 16)];
    }
    async waitIdle(stage) {
      let [s, t] = await this.status();
      while (s === ST.DNBUSY) { if (t) await sleep(t); [s, t] = await this.status(); }
      if (s !== ST.DNIDLE) throw new Error(`허브에 쓰는 중 문제가 생겼어요 (${stage}, 상태 ${s}). 다시 업데이트 모드로 켜고 시도해 주세요.`);
    }
    async command(code, addr, stage) {
      const b = new Uint8Array(5); b[0] = code; new DataView(b.buffer).setUint32(1, addr, true);
      await this.out(1 /*DNLOAD*/, 0, b);
      await this.waitIdle(stage);
    }
    async erase(addr, length, onBytes) {
      const end = addr + length;
      for (const [a, size] of SECTORS[this.mcu]) {
        if (a + size <= addr || a >= end) continue;
        if (a < FW_ADDR - 32 * KB) throw new Error("부트로더 영역은 지우지 않아요");   // 안전장치
        await this.command(0x41, a, "지우기");
        onBytes && onBytes(size);
      }
    }
    eraseSize(addr, length) {
      const end = addr + length;
      return SECTORS[this.mcu].reduce((n, [a, size]) => (a + size <= addr || a >= end ? n : n + size), 0);
    }
    async write(addr, data, onBytes) {
      const unit = this.mcu === "h5" ? 16 : 4;
      if (addr % unit) throw new Error("쓰기 주소가 맞지 않아요");
      for (let w = 0; w < data.length;) {
        await this.command(0x21, addr + w, "주소");
        const n = Math.min(this.xfer, data.length - w);
        await this.out(1 /*DNLOAD*/, 2, data.subarray(w, w + n));
        await this.waitIdle("쓰기");
        w += n; onBytes && onBytes(n);
      }
    }
    async exit() {   // 업데이트 모드를 끝내고 새 펌웨어로 다시 켜요
      await this.command(0x21, FLASH_BASE, "주소");
      try { await this.out(1, 0); await this.status(); } catch (e) {}
      try { await this.dev.close(); } catch (e) {}
    }
  }

  // 어떤 허브(어떤 부트로더)인지 알아내요 — 공식 도구의 determine_platform과 같은 판단
  function whichHub(dev, layout) {
    const bcd = (dev.deviceVersionMajor << 8) | (dev.deviceVersionMinor << 4) | dev.deviceVersionSubminor;
    if (bcd === 0x0100) return { mcu: "f4", platform: "prime_hub" };          // 레고 기본 부트로더
    if (bcd === 0x0300 && /064Kg/.test(layout) && /128Kg/.test(layout)) return { mcu: "f4", platform: "prime_hub_f4" };
    if (bcd === 0x0300 && /08Kg/.test(layout)) return { mcu: "h5", platform: "prime_hub_h5" };
    return { mcu: null, platform: null, bcd };
  }

  async function installSpike({ hubName, onStatus, onProgress }) {
    if (!navigator.usb) throw new Error("이 브라우저는 USB 연결을 지원하지 않아요. 크롬에서 설치한 웹앱으로 열어 주세요.");
    let device;
    try {
      device = await navigator.usb.requestDevice({ filters: [
        { vendorId: LEGO_VID, productId: PID.primeDfu }, { vendorId: LEGO_VID, productId: PID.inventorDfu }] });
    } catch (e) {
      if (e && e.name === "NotFoundError") { const err = new Error("허브를 고르지 않았거나 찾지 못했어요."); err.noDevice = true; throw err; }
      throw e;
    }
    const dfu = new Dfu(device);
    try {
      await dfu.open();
      const hw = whichHub(device, dfu.layout);
      if (!hw.platform) {
        const err = new Error(`처음 보는 종류의 허브예요 (bcd ${hw.bcd != null ? hw.bcd.toString(16) : "?"}). 안전을 위해 여기서는 설치하지 않을게요. Pybricks 공식 사이트에서 설치해 주세요.`);
        err.official = true; throw err;
      }
      dfu.mcu = hw.mcu;
      let image, addr, headerAt, headerLen;
      if (hw.platform === "prime_hub_h5") {
        const { firmware } = await buildFirmware("primehub-h5.bin", "primehub.json", "prime_hub_h5", hubName);
        if (firmware[0x264] >= 0x0f || firmware.length < 16 * KB) throw new Error("이 펌웨어는 이 허브와 맞지 않아요.");
        await installH5(dfu, firmware, onStatus, onProgress);
        return PBW.Firmware.version;
      }
      const { firmware } = await buildFirmware("primehub-f4.bin", "primehub.json", "prime_hub_f4", hubName);
      if (firmware[0x1f0] >= 0x0f) throw new Error("이 펌웨어는 이 허브와 맞지 않아요.");
      if (hw.platform === "prime_hub_f4") {          // 2단계 부트로더가 이미 있어요
        image = firmware; addr = FW_ADDR; headerAt = 0;
      } else {                                       // 레고 기본 부트로더: 2단계 부트로더를 같이 넣어야 해요
        let mboot = null;
        try { const r = await fetch("fw/mboot.bin", { cache: "no-cache" }); if (r.ok) mboot = new Uint8Array(await r.arrayBuffer()); } catch (e) {}
        if (!mboot || mboot.length !== 32 * KB) {
          const err = new Error("이 허브는 Pybricks 4를 처음 설치하는 허브예요. 처음 한 번은 Pybricks 공식 사이트에서 설치해 주세요 (레고 부트로더 조각이 필요해서 이 웹앱에는 넣지 않았어요). 그다음부터는 여기서 업데이트할 수 있어요.");
          err.official = true; throw err;
        }
        image = new Uint8Array(mboot.length + firmware.length); image.set(mboot); image.set(firmware, mboot.length);
        addr = FW_ADDR - 32 * KB; headerAt = 32 * KB;
      }
      headerLen = 4;
      const header = image.slice(headerAt, headerAt + headerLen);
      const body = image.slice(); body.fill(0xff, headerAt, headerAt + headerLen);
      const eraseTotal = dfu.eraseSize(addr, image.length), total = eraseTotal + image.length + headerLen;
      let done = 0; const tick = (n) => { done += n; onProgress && onProgress(done / total); };
      onStatus && onStatus("예전 펌웨어 지우는 중");
      await dfu.erase(addr, image.length, tick);
      onStatus && onStatus("Pybricks 펌웨어 넣는 중");
      await dfu.write(addr, body, tick);
      await dfu.write(FW_ADDR, header, tick);       // 시작 부분은 맨 마지막에
      onStatus && onStatus("허브 다시 켜는 중");
      await dfu.exit();
      return PBW.Firmware.version;
    } catch (e) {
      try { await device.close(); } catch (x) {}
      throw e;
    }
  }

  // 새 허브(STM32H5): 8KB 쪽 단위, 16바이트 단위로 써요. 공식 도구와 같은 순서.
  async function installH5(dfu, fw, onStatus, onProgress) {
    const PAGE = 8 * KB, crit = Math.floor(0x264 / 16) * 16;
    const total = dfu.eraseSize(FW_ADDR, fw.length) + fw.length;
    let done = 0; const tick = (n) => { done += n; onProgress && onProgress(done / total); };
    onStatus && onStatus("예전 펌웨어 지우는 중");
    await dfu.erase(FW_ADDR, PAGE, tick);                                   // 첫 쪽만 먼저 지우고
    await dfu.write(FW_ADDR + crit, fw.subarray(crit, crit + 16), tick);    // 호환 표시를 먼저 써요
    await dfu.erase(FW_ADDR + PAGE, fw.length - PAGE, tick);                // 나머지 지우기
    onStatus && onStatus("Pybricks 펌웨어 넣는 중");
    await dfu.write(FW_ADDR + crit + 16, fw.subarray(crit + 16), tick);
    await dfu.write(FW_ADDR + 16, fw.subarray(16, crit), tick);
    await dfu.write(FW_ADDR, fw.subarray(0, 16), tick);                     // 시작 부분은 맨 마지막에
    onStatus && onStatus("허브 다시 켜는 중");
    await dfu.exit();
  }

  /* ---------- EV3 (펌웨어 업데이트 모드, HID) ---------- */
  async function installEv3({ hubName, onStatus, onProgress }) {
    if (!navigator.hid) throw new Error("이 브라우저는 EV3 설치(WebHID)를 지원하지 않아요. 크롬에서 설치한 웹앱으로 열어 주세요.");
    const { firmware, version } = await buildFirmware("ev3.bin", "ev3.json", "ev3", hubName);
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: LEGO_VID, productId: PID.ev3Boot }] });
    if (!devices.length) { const err = new Error("EV3를 고르지 않았거나 찾지 못했어요."); err.noDevice = true; throw err; }
    const hid = devices[0];
    await hid.open();
    let msgId = 0, waiting = null;
    const onReport = (e) => {
      const d = e.data;
      if (!d.byteLength) return;
      let type = d.getUint8(4), status = d.getUint8(6);
      const reply = { len: d.getInt16(0, true), id: d.getInt16(2, true), cmd: d.getUint8(5) };
      // 윈도우 USB 3.0 등에서 가끔 요청이 그대로 돌아오는 문제를 Pybricks Code처럼 넘겨요
      if (type === 0x01) { type = 0x03; status = 0; }
      reply.type = type; reply.status = status;
      const w = waiting; waiting = null;
      w && w(reply);
    };
    hid.addEventListener("inputreport", onReport);
    const send = async (command, payload) => {
      const n = payload ? payload.length : 0;
      const buf = new Uint8Array(n + 6), dv = new DataView(buf.buffer);
      const id = (msgId = (msgId + 1) & 0x7fff);
      dv.setInt16(0, n + 4, true); dv.setInt16(2, id, true); dv.setUint8(4, 0x01); dv.setUint8(5, command);
      if (payload) buf.set(payload, 6);
      const reply = new Promise((resolve, reject) => {
        waiting = resolve;
        setTimeout(() => reject(new Error("EV3가 응답하지 않아요")), 5000);
      });
      await hid.sendReport(0, buf);
      const r = await reply;
      if (r.id !== id || r.cmd !== command) throw new Error("EV3 응답이 맞지 않아요 (명령 " + command + ")");
      if (r.status !== 0) throw new Error("EV3가 명령을 거절했어요 (코드 " + r.status + ")");
    };
    try {
      const ERASE = 2 * 64 * 1024, CHUNK = 1018;
      for (let i = 0; i < firmware.length; i += ERASE) {
        const sector = firmware.subarray(i, i + ERASE);
        const p = new Uint8Array(8), dv = new DataView(p.buffer);
        dv.setUint32(0, i, true); dv.setUint32(4, sector.length, true);
        onStatus && onStatus("지우고 넣는 중");
        await send(0xf0, p);                       // 지우고 받을 준비
        onProgress && onProgress((i + sector.length / 2) / firmware.length);
        for (let j = 0; j < sector.length; j += CHUNK) await send(0xf2, sector.subarray(j, j + CHUNK));  // 보내기
        onProgress && onProgress((i + sector.length) / firmware.length);
      }
      onStatus && onStatus("EV3 다시 켜는 중");
      await send(0xf4);                            // 새 펌웨어로 시작
    } finally {
      hid.removeEventListener("inputreport", onReport);
      hid.close().catch(() => {});
    }
    return version;
  }

  PBW.Firmware = { installSpike, installEv3, version: "4.1.1", officialUrl: OFFICIAL };
})();
