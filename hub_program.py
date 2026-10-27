# 로봇 조종기 허브 프로그램
# 모든 로봇이 이 파일 그대로 사용 (포트·바퀴는 조종 앱 설정에서 바꿈)

from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction, Color
from pybricks.robotics import DriveBase
from pybricks.tools import wait, StopWatch
from usys import stdin
from uselect import poll

# 허브 프로그램 버전 (조종 앱이 이걸 보고 예전 버전이면 업데이트를 권해요)
HUB_PROGRAM_VERSION = 3

hub = PrimeHub()
keyboard = poll()
keyboard.register(stdin)

PORTS = {"a": Port.A, "b": Port.B, "c": Port.C, "d": Port.D, "e": Port.E, "f": Port.F}

# ===== 기본 로봇 구조 (앱 없이 실행할 때 사용) =====
# 왼쪽 E, 오른쪽 F, 팔 A, 집게 D / 큰 바퀴 88mm / 바퀴 간격 112mm / 왼쪽 반대로
config = {"lp": "e", "rp": "f", "ap": "a", "gp": "d",
          "wheel": 88, "axle": 112, "flags": 1}

# ===== 기본 조종 설정 =====
speed = 200        # 직진 속도 (mm/s)
turn = 120         # 회전 속도 (도/초)
curve = 0          # 회전 방식: 0 스핀턴, 100 피벗턴, 200 큰 곡선
arm_speed = 300    # 팔 속도 (도/초)
grip_speed = 300   # 집게 속도 (도/초)
diag = 60          # 대각선 곡선 주행 때 도는 정도 (도/초)


def read_line():
    # 줄바꿈이 올 때까지 글자를 모음.
    # 0.5초 안에 다음 글자가 안 오거나 너무 길면 포기 (끊긴 데이터 때문에 멈추지 않게)
    text = ""
    while True:
        if not keyboard.poll(500):
            return None
        c = stdin.read(1)
        if c == "\n":
            return text
        text += c
        if len(text) > 40:
            return None


# ===== 값 범위 (앱과 똑같이). 이상한 값이 와도 이 안으로 잘라서 씀 =====
LIMITS = {
    "speed": (50, 800),     # 직진 속도 mm/s
    "turn": (30, 500),      # 회전 속도 도/초
    "curve": (0, 200),      # 회전 방식
    "arm": (50, 1000),      # 팔 속도 도/초
    "grip": (50, 1000),     # 집게 속도 도/초
    "diag": (10, 500),      # 대각선 곡선 도/초
    "wheel": (20, 200),     # 바퀴 지름 mm
    "axle": (40, 300),      # 바퀴 간격 mm
}


def clamp(name, value):
    lo, hi = LIMITS[name]
    return max(lo, min(hi, int(value)))


def apply_settings(text):
    # 예) 200,120,0,300,300,60  (예전 앱은 마지막 대각선 값 없이 5개)
    global speed, turn, curve, arm_speed, grip_speed, diag
    if text is None:
        return
    try:
        v = [int(x) for x in text.split(",")]
        if len(v) not in (5, 6):
            return
        speed = clamp("speed", v[0])
        turn = clamp("turn", v[1])
        curve = clamp("curve", v[2])
        arm_speed = clamp("arm", v[3])
        grip_speed = clamp("grip", v[4])
        if len(v) == 6:
            diag = clamp("diag", v[5])
        hub.display.number(speed // 10)
    except Exception:
        pass


def parse_config(text):
    # 예) efad,88,112,1  (포트 4개, 바퀴 지름, 바퀴 간격, 방향)
    parts = text.split(",")
    p = parts[0]
    return {"lp": p[0], "rp": p[1], "ap": p[2], "gp": p[3],
            "wheel": clamp("wheel", parts[1]), "axle": clamp("axle", parts[2]),
            "flags": max(0, min(15, int(parts[3])))}


# ===== 1. 앱에서 로봇 구조 받기 (최대 3초 기다림) =====
print("VER " + str(HUB_PROGRAM_VERSION))
print("WAIT")
timer = StopWatch()
while timer.time() < 3000:
    if keyboard.poll(0):
        c = stdin.read(1)
        if c == "C":
            try:
                config = parse_config(read_line())
            except Exception:
                pass
            break
        elif c == "P":
            apply_settings(read_line())
    wait(10)


# ===== 2. 모터 준비 =====
def make_motor(name, inverted):
    if name not in PORTS:
        return None   # "없음"
    direction = Direction.COUNTERCLOCKWISE if inverted else Direction.CLOCKWISE
    try:
        return Motor(PORTS[name], direction)
    except Exception:
        print("ERR " + name.upper() + " 포트에 모터가 없어요. 연결을 확인하세요.")
        hub.display.char(name.upper())
        wait(1500)
        return None


flags = config["flags"]
left = make_motor(config["lp"], flags & 1)
right = make_motor(config["rp"], flags & 2)
arm = make_motor(config["ap"], flags & 4)
gripper = make_motor(config["gp"], flags & 8)
AXLE = config["axle"]

robot = None
if left and right:
    try:
        robot = DriveBase(left, right, config["wheel"], AXLE)
    except Exception:
        print("ERR 바퀴 설정에 문제가 있어요. 바퀴 지름과 간격을 확인하세요.")


def turn_forward():
    # 회전하면서 앞으로 가는 속도. curve 100 = 안쪽 바퀴가 멈추는 속도 (피벗턴)
    pivot = turn * 3.1416 / 180 * (AXLE / 2)
    return pivot * curve / 100


def drive(v, r):
    if robot:
        robot.drive(v, r)


def run(motor, s):
    if motor:
        motor.run(s)


def stop_drive():
    if robot:
        robot.stop()


def hold_arm():
    if arm:
        arm.hold()


def hold_grip():
    if gripper:
        gripper.hold()


def stop_all():
    stop_drive()
    hold_arm()
    hold_grip()


hub.display.number(speed // 10)
def identify():
    # "내 로봇 찾기": 삐삐 소리 + 초록 불 깜빡 (교실에서 어느 로봇에 연결됐는지 확인)
    for _ in range(2):
        hub.light.on(Color.GREEN)
        hub.speaker.beep(1200, 120)
        hub.light.off()
        wait(80)
    hub.light.on(Color.GREEN)


identify()        # 연결되면 한 번 알려 줌 (끝난 뒤에 준비 완료를 보내야 첫 버튼이 안 씹힘)
print("READY")

# ===== 3. 조종 명령 받기 =====
# 안전장치: 앱이 0.25초마다 보내는 신호(.)가 1초 넘게 안 오면 모두 멈춤
# (블루투스 끊김, 앱 멈춤 대비. 노트북 controller.py는 신호를 안 보내서 꺼진 상태로 동작)
watchdog = False
moving = False
last_rx = StopWatch()

# 주행·팔·집게를 따로따로 기억 (동시에 움직일 수 있게). "-"는 멈춤
state = {"d": "-", "a": "-", "g": "-"}


def set_drive(c):
    # G: 앞+왼쪽  H: 앞+오른쪽  J: 뒤+왼쪽  K: 뒤+오른쪽 (대각선 곡선 주행)
    if c == "F":
        drive(speed, 0)
    elif c == "B":
        drive(-speed, 0)
    elif c == "L":
        drive(turn_forward(), -turn)
    elif c == "R":
        drive(turn_forward(), turn)
    elif c == "G":
        drive(speed, -diag)
    elif c == "H":
        drive(speed, diag)
    elif c == "J":
        drive(-speed, diag)    # 후진은 자동차처럼: 뒤+왼쪽 = 뒤쪽이 왼쪽으로
    elif c == "K":
        drive(-speed, -diag)
    else:
        stop_drive()


def set_arm(c):
    if c == "T":
        run(arm, arm_speed)
    elif c == "Q":
        run(arm, -arm_speed)
    else:
        hold_arm()


def set_grip(c):
    if c == "X":
        run(gripper, grip_speed)
    elif c == "O":
        run(gripper, -grip_speed)
    else:
        hold_grip()


def apply_state(text):
    # 예) MF-O : 앞으로 + 팔 그대로 + 집게 펴기 (조종 앱이 버튼이 바뀔 때마다 보냄)
    global moving
    if text is None or len(text) != 3:
        return
    d, a, g = text[0], text[1], text[2]
    if d not in "FBLRGHJK":
        d = "-"
    if a not in "TQ":
        a = "-"
    if g not in "XO":
        g = "-"
    # 바뀐 것만 다시 명령 (팔이 움직이는 중에 주행을 바꿔도 팔은 그대로)
    if d != state["d"]:
        set_drive(d)
    if a != state["a"]:
        set_arm(a)
    if g != state["g"]:
        set_grip(g)
    state["d"], state["a"], state["g"] = d, a, g
    moving = d != "-" or a != "-" or g != "-"


def reset_state():
    state["d"], state["a"], state["g"] = "-", "-", "-"

while True:
    if not keyboard.poll(10):
        if watchdog and moving and last_rx.time() > 1000:
            stop_all()
            reset_state()
            moving = False
            print("ERR 앱 신호가 끊겨서 로봇을 멈췄어요")
        continue

    cmd = stdin.read(1)
    last_rx.reset()

    # 앱 연결 확인 신호
    if cmd == ".":
        watchdog = True

    # 조종 앱: 주행·팔·집게 상태를 한 번에 (동시 동작)  예) MF-O
    elif cmd == "M":
        apply_state(read_line())

    # 한 글자 명령 (노트북 controller.py, 예전 앱): 한 번에 한 가지 동작
    elif cmd and cmd in "FBLRGHJK":
        apply_state(cmd + "--")
    elif cmd == "T" or cmd == "Q":
        apply_state("-" + cmd + "-")
    elif cmd == "X" or cmd == "O":
        apply_state("--" + cmd)

    # 버튼 뗌: 모두 멈춤 (팔·집게는 그 자리 유지)
    # 내 로봇 찾기
    elif cmd == "I":
        stop_all()
        reset_state()
        moving = False
        identify()

    elif cmd == "S":
        stop_all()
        reset_state()
        moving = False

    # 조종 설정 바뀜 (움직이는 중이면 새 속도로 바로)
    elif cmd == "P":
        apply_settings(read_line())
        if state["d"] != "-":
            set_drive(state["d"])
        if state["a"] != "-":
            set_arm(state["a"])
        if state["g"] != "-":
            set_grip(state["g"])

    # 로봇 구조는 시작할 때만 적용 (앱이 프로그램을 다시 시작함)
    elif cmd == "C":
        read_line()

    # 노트북 controller.py용 속도 조절 (L1 / R1)
    elif cmd == "+":
        speed = min(speed + 50, 800)
        hub.display.number(speed // 10)
    elif cmd == "-":
        speed = max(speed - 50, 50)
        hub.display.number(speed // 10)
