# 듀얼쇼크 → 파이브릭스 허브 조종 (노트북용)
# 실행하면 주변 허브를 찾아서 번호로 고름. 코드 수정 필요 없음.
# 필요: python -m pip install pygame bleak

import asyncio
import os
import pygame
from bleak import BleakScanner, BleakClient

PYBRICKS_SERVICE = "c5f50001-8280-46da-89f4-6d8051e4aeef"   # 고정값
PYBRICKS_CHAR = "c5f50002-8280-46da-89f4-6d8051e4aeef"      # 고정값
FLAG_PROGRAM_RUNNING = 1 << 6

# 마지막으로 고른 허브 이름을 저장하는 파일 (이 파일과 같은 폴더)
LAST_HUB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "last_hub.txt")

# 듀얼쇼크 버튼 번호 (pygame 기준)
BUTTONS = {
    "up": 11, "down": 12, "left": 13, "right": 14,
    "cross": 0, "circle": 1, "square": 2, "triangle": 3,
    "l1": 9, "r1": 10,
}


# ===== 컨트롤러 =====
class Pad:
    """컨트롤러가 빠졌다 다시 꽂혀도 알아서 다시 잡음"""

    def __init__(self):
        self.js = None
        self.grab()

    def grab(self):
        try:
            if pygame.joystick.get_count() > 0:
                self.js = pygame.joystick.Joystick(0)
                return True
        except pygame.error:
            pass
        self.js = None
        return False

    def read_command(self):
        try:
            for e in pygame.event.get():
                if e.type == getattr(pygame, "JOYDEVICEREMOVED", -1):
                    self.js = None
                    print("컨트롤러가 빠졌어요. 로봇을 멈춥니다.")
                elif e.type == getattr(pygame, "JOYDEVICEADDED", -1) and self.js is None:
                    if self.grab():
                        print("컨트롤러 다시 연결됨:", self.js.get_name())
            if self.js is None:
                return "S"
            pressed = lambda name: self.js.get_button(BUTTONS[name])
            up, down = pressed("up"), pressed("down")
            left, right = pressed("left"), pressed("right")
            if up and down: up = down = False          # 반대 방향 동시 → 무시
            if left and right: left = right = False
            if up and left:         return "G"   # 대각선 곡선 주행
            if up and right:        return "H"
            if down and left:       return "J"
            if down and right:      return "K"
            if up:                  return "F"
            if down:                return "B"
            if left:                return "L"
            if right:               return "R"
            if pressed("triangle"): return "T"
            if pressed("square"):   return "Q"
            if pressed("cross"):    return "X"
            if pressed("circle"):   return "O"
            if pressed("l1"):       return "-"
            if pressed("r1"):       return "+"
        except pygame.error:
            self.js = None   # 읽다가 오류 = 컨트롤러 빠짐 → 정지
        return "S"


# ===== 허브 고르기 =====
def load_last():
    try:
        with open(LAST_HUB_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def save_last(name):
    try:
        with open(LAST_HUB_FILE, "w", encoding="utf-8") as f:
            f.write(name)
    except OSError:
        pass


async def find_hubs():
    print("\n주변 허브 찾는 중... (5초)")
    found = await BleakScanner.discover(timeout=5, return_adv=True)
    hubs, others = [], []
    for dev, adv in found.values():
        name = adv.local_name or dev.name
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if PYBRICKS_SERVICE in uuids:
            hubs.append((dev, name or "(이름 없음)"))
        elif name:
            others.append((dev, name + "  (허브인지 확인 안 됨)"))
    hubs.sort(key=lambda h: h[1])
    if hubs:
        return hubs
    # 허브 표시를 못 읽는 컴퓨터 대비: 이름 있는 기기 전부 보여 줌
    others.sort(key=lambda h: h[1])
    return others


def plain(name):
    return name.replace("  (허브인지 확인 안 됨)", "")


async def choose_hub():
    last = load_last()
    while True:
        hubs = await find_hubs()
        if not hubs:
            print("허브를 못 찾았어요. 허브 전원과 Pybricks Code 탭이 닫혔는지 확인하세요.")
            input("엔터를 누르면 다시 찾아요...")
            continue

        print("\n찾은 허브:")
        default = None
        for i, (dev, name) in enumerate(hubs, 1):
            mark = ""
            if plain(name) == last:
                default, mark = i, "  ← 지난번"
            print(f"  {i}. {name}{mark}")
        print("  0. 다시 찾기")

        hint = f" (엔터 = {default}번)" if default else ""
        while True:
            ans = input(f"번호를 고르세요{hint}: ").strip()
            if ans == "" and default:
                ans = str(default)
            if ans == "0":
                break   # 다시 찾기
            if ans.isdigit() and 1 <= int(ans) <= len(hubs):
                dev, name = hubs[int(ans) - 1]
                save_last(plain(name))
                return dev, plain(name)
            print(f"1~{len(hubs)} 중에서 골라 주세요. (0 = 다시 찾기)")


# ===== 연결해서 조종 =====
async def send(client, data: bytes):
    await client.write_gatt_char(PYBRICKS_CHAR, b"\x06" + data, response=True)


async def control(pad, dev, name):
    ready = asyncio.Event()
    stopped = asyncio.Event()
    state = {"buf": "", "running": None}

    def on_notify(_, data: bytearray):
        if not data:
            return
        # 허브 상태 (프로그램 실행 중인지)
        if data[0] == 0x00 and len(data) >= 5:
            flags = int.from_bytes(bytes(data[1:5]), "little")
            running = bool(flags & FLAG_PROGRAM_RUNNING)
            if ready.is_set() and state["running"] and not running:
                stopped.set()
            state["running"] = running
            return
        # 허브가 print한 글 (여러 조각으로 나뉘어 올 수 있어서 모아서 줄 단위로)
        if data[0] == 0x01:
            state["buf"] += bytes(data[1:]).decode("utf-8", "replace")
            while "\n" in state["buf"]:
                line, state["buf"] = state["buf"].split("\n", 1)
                line = line.strip()
                if line == "READY":
                    ready.set()
                elif line.startswith("ERR"):
                    print("허브:", line[3:].strip())
            if len(state["buf"]) > 500:
                state["buf"] = ""

    async with BleakClient(dev) as client:
        print(f"'{name}' 연결됨!")
        await client.start_notify(PYBRICKS_CHAR, on_notify)

        # 허브 프로그램 다시 시작
        try:
            await client.write_gatt_char(PYBRICKS_CHAR, b"\x00", response=True)
        except Exception:
            pass
        await asyncio.sleep(0.4)
        try:
            await client.write_gatt_char(PYBRICKS_CHAR, b"\x01", response=True)
        except Exception:
            pass

        print("허브 준비 기다리는 중...")
        try:
            await asyncio.wait_for(ready.wait(), timeout=6)
        except asyncio.TimeoutError:
            print("(허브 응답이 없어요. 허브 코드가 최신인지 확인하세요. 일단 시작해요)")
            ready.set()

        print("조종 시작! (끄려면 이 창을 닫으세요)")
        last = None
        quiet = 0.0
        while client.is_connected:
            if stopped.is_set():
                print("허브 프로그램이 멈췄어요 (허브 버튼을 눌렀거나 오류). 다시 시작합니다.")
                return
            cmd = pad.read_command()
            if cmd != last:
                await send(client, cmd.encode())
                last = cmd
                quiet = 0.0
            elif quiet >= 0.25:
                # 연결 유지 신호: 끊기면 허브가 1초 안에 스스로 멈춤
                await send(client, b".")
                quiet = 0.0
            await asyncio.sleep(0.02)
            quiet += 0.02


async def main():
    pygame.init()
    pygame.joystick.init()
    pad = Pad()
    if pad.js is None:
        print("듀얼쇼크가 연결 안 됐어요. 연결 후 다시 실행하세요.")
        input("엔터를 누르면 종료")
        return
    print("컨트롤러:", pad.js.get_name())

    dev, name = await choose_hub()

    # 연결이 끊기거나 프로그램이 멈추면 같은 허브를 다시 찾아서 연결
    while True:
        try:
            await control(pad, dev, name)
            print("다시 연결합니다...")
        except Exception as e:
            print("연결 문제:", e, "→ 3초 뒤 다시 시도합니다.")
            await asyncio.sleep(2)
        await asyncio.sleep(1)
        again = await BleakScanner.find_device_by_name(name, timeout=5)
        if again:
            dev = again


if __name__ == "__main__":
    asyncio.run(main())
