"""Recipe source. Rebuild catalog with python scripts/practice/author_catalog.py."""
import json
from pathlib import Path

LABS = {}


def lab(name, goal, requires, prepare, solve, check, restore='', task='', timeout=120):
    LABS[name] = dict(goal=goal, requires=['python3', *requires],
                     prepare=prepare, solve=solve, check=check,
                     restore=restore + '\nfind "$WORK" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
                     task=task, timeout=timeout, acceptance='pending-live')


def observe(name, goal, requires, command, task):
    # Run the same observation again at check time, rather than trusting a learner's assertion.
    lab(name, goal, requires, 'printf "Read the lesson and record the requested facts.\\n"',
        f'({command}) > "$WORK/observation.txt"',
        f'test -s "$WORK/observation.txt"\n({command}) > "$STATE/current.txt"\ndiff -u "$STATE/current.txt" "$WORK/observation.txt"\ncat "$STATE/current.txt"', task=task)


lab('process', 'Найти PID учебной программы по её командной строке', ['ps', 'runuser'],
    'runuser -u "$COURSE_USER" -- python3 -c "import time; time.sleep(3600)" "mayak-$NS" >/dev/null 2>&1 &\necho $! > "$STATE/launcher.pid"\nsleep 0.3',
    'pgrep -f "^python3 -c import time; time.sleep\\(3600\\) mayak-$NS$" > "$WORK/pid.txt"',
    'pid=$(cat "$WORK/pid.txt"); [[ "$pid" =~ ^[0-9]+$ ]]; tr "\\0" " " < "/proc/$pid/cmdline" | grep -F "mayak-$NS"; test "$(stat -c %U /proc/$pid)" = "$COURSE_USER"',
    'pkill -f "^python3 -c import time; time.sleep\\(3600\\) mayak-$NS$" || test "$?" = 1\nif test -f "$STATE/launcher.pid"; then wait "$(cat "$STATE/launcher.pid")" 2>/dev/null || true; fi',
    'Найди python3 с меткой mayak- в ps и запиши только его PID в work/pid.txt.')

lab('permissions', 'Разрешить владельцу чтение заметки, не открывая её всем', ['runuser', 'stat'],
    'printf "private note\\n" > "$WORK/note.txt"; chown "$COURSE_USER:" "$WORK/note.txt"; chmod 000 "$WORK/note.txt"',
    'chmod 600 "$WORK/note.txt"',
    'test "$(stat -c %a "$WORK/note.txt")" = 600; runuser -u "$COURSE_USER" -- cat "$WORK/note.txt"; test "$(stat -c %U "$WORK/note.txt")" = "$COURSE_USER"',
    task='От имени ученика измени режим note.txt: чтение и запись владельцу, никаких прав группе и остальным.')

lab('memory', 'Различить доступную память, кэш и давление памяти', [],
    'test -r /proc/pressure/memory; test -r /proc/meminfo',
    'python3 - <<\'PY\' > "$WORK/memory.json"\nimport json\nm=dict((k,int(v.split()[0])) for k,v in (line.split(":",1) for line in open("/proc/meminfo")))\nprint(json.dumps({"available_kib":m["MemAvailable"],"total_kib":m["MemTotal"],"pressure_source":"/proc/pressure/memory"}))\nPY',
    'python3 - <<\'PY\'\nimport json,os\na=json.load(open(os.environ["WORK"]+"/memory.json")); total=int(open("/proc/meminfo").readline().split()[1]); assert a["total_kib"]==total and 0<=a["available_kib"]<=total and a["pressure_source"]=="/proc/pressure/memory"; print(a); print(open(a["pressure_source"]).read())\nPY',
    task='В memory.json запиши total_kib и available_kib из /proc/meminfo, а также pressure_source. Объяснение кэша сохрани в уроке.')

observe('packages', 'Определить пакет, которому принадлежит установленная программа', ['dpkg-query'],
        'dpkg-query -S /usr/bin/python3; dpkg-query -W -f=\'${Package} ${Version}\\n\' python3-minimal',
        'После установки python3 штатным apt на учебной ВМ запиши владельца /usr/bin/python3 и версию python3-minimal в observation.txt.')

lab('shell-data', 'Передать имена файлов с пробелами без разбиения', ['find'],
    'mkdir "$WORK/input"; touch "$WORK/input/first note" "$WORK/input/second note"; if test "$VARIANT" = 1; then touch "$WORK/input/third note"; fi',
    'find "$WORK/input" -type f -printf "%f\\0" | sort -z > "$WORK/names.bin"',
    'find "$WORK/input" -type f -printf "%f\\0" | sort -z > "$STATE/expected.bin"; cmp "$STATE/expected.bin" "$WORK/names.bin"; python3 -c \'import os; print(open(os.environ["WORK"]+"/names.bin","rb").read().split(bytes([0])))\'',
    task='Сохрани отсортированные имена из input в names.bin. Разделитель — нулевой байт; полный путь не включай.')

lab('shell-failure', 'Ограничить ожидание команды и сохранить код timeout', ['timeout','runuser'],
    'printf "Timeout is %s seconds\\n" "$((VARIANT+1))"',
    '''cat > "$WORK/solution.sh" <<'SH'
timeout "$1" sleep 30
code=$?
printf '%s\\n' "$code"
SH
chown "$COURSE_USER:" "$WORK/solution.sh"''',
    '''python3 - <<'PY'
import subprocess,time,os
e=os.environ; seconds=int(e['VARIANT'])+1; start=time.monotonic()
r=subprocess.run(['runuser','-u',e['COURSE_USER'],'--','bash',e['WORK']+'/solution.sh',str(seconds)],capture_output=True,text=True,timeout=seconds+3)
elapsed=time.monotonic()-start
assert r.returncode==0 and r.stdout.strip()=='124' and seconds*.8<=elapsed<=seconds+3,(r.stdout,r.stderr,elapsed)
print('Observed timeout:',r.stdout.strip(),'elapsed seconds:',elapsed)
PY''',
    task='Создай solution.sh: первый аргумент — предел ожидания. Запусти timeout с этим пределом и sleep 30, выведи реальный код возврата. Проверка выполнит сценарий от имени ученика с пределом 1 или 2 секунды; один записанный ответ 124 не принимается.')

lab('python-result', 'Сохранить stdout, stderr и код завершения отдельно', ['runuser'], 'true',
    '''cat > "$WORK/solution.py" <<'PY'
import subprocess,json,sys
r=subprocess.run(sys.argv[1:],capture_output=True,text=True,timeout=3)
print(json.dumps({'stdout':r.stdout,'stderr':r.stderr,'code':r.returncode}))
PY
chown "$COURSE_USER:" "$WORK/solution.py"''',
    '''python3 - <<'PY'
import subprocess,json,os
e=os.environ; v=int(e['VARIANT']); out='out' if v==0 else 'another out'; err='err' if v==0 else 'another err'; code=7+v
child=f'import sys; print({out!r}); print({err!r},file=sys.stderr); sys.exit({code})'
r=subprocess.run(['runuser','-u',e['COURSE_USER'],'--','python3',e['WORK']+'/solution.py','python3','-c',child],capture_output=True,text=True,timeout=5)
assert r.returncode==0,r.stderr
a=json.loads(r.stdout); assert a=={'stdout':out+'\\n','stderr':err+'\\n','code':code},a
print(a)
PY''',
    task='Создай solution.py: запусти sys.argv[1:] через subprocess.run и выведи JSON с stdout, stderr и code. Проверка передаст разные дочерние программы в двух вариантах. Статический result.json не считается исполнением.')

lab('git-change', 'Закоммитить изменение конфигурации вместе с объяснением', ['git', 'runuser'],
    'runuser -u "$COURSE_USER" -- git init -q "$WORK/repo"; printf "port=8080\\n" > "$WORK/repo/service.conf"; chown "$COURSE_USER:" "$WORK/repo/service.conf"; runuser -u "$COURSE_USER" -- git -C "$WORK/repo" -c user.name=Student -c user.email=student@localhost add service.conf; runuser -u "$COURSE_USER" -- git -C "$WORK/repo" -c user.name=Student -c user.email=student@localhost commit -qm baseline',
    'printf "port=%s\\n" "$((8081+VARIANT))" > "$WORK/repo/service.conf"; runuser -u "$COURSE_USER" -- git -C "$WORK/repo" add service.conf; runuser -u "$COURSE_USER" -- git -C "$WORK/repo" -c user.name=Student -c user.email=student@localhost commit -qm "Move note port to avoid listener conflict"',
    'runuser -u "$COURSE_USER" -- git -C "$WORK/repo" diff --exit-code; test -z "$(runuser -u "$COURSE_USER" -- git -C "$WORK/repo" status --porcelain)"; test "$(runuser -u "$COURSE_USER" -- git -C "$WORK/repo" rev-list --count HEAD)" = 2; grep -x "port=$((8081+VARIANT))" "$WORK/repo/service.conf"; runuser -u "$COURSE_USER" -- git -C "$WORK/repo" log -1 --format=%s | grep -E ".{15}"',
    task='В repo измени port на 8081 (вариант 0) или 8082 (вариант 1). Сделай отдельный коммит с объяснением причины; рабочее дерево должно быть чистым.')

observe('boot', 'Связать параметры загрузки с реально смонтированным корнем', ['findmnt'],
        'findmnt -n -o SOURCE,FSTYPE /; cat /proc/cmdline',
        'Сохрани источник и тип корневой ФС, затем параметры ядра в observation.txt. Не меняй загрузчик.')
observe('disk-identity', 'Зафиксировать идентичность устройств до записи', ['lsblk'],
        'lsblk -J -o NAME,TYPE,SIZE,MODEL,SERIAL,WWN',
        'В observation.txt сохрани JSON lsblk с NAME,TYPE,SIZE,MODEL,SERIAL,WWN. Пустой SERIAL — ограничение идентификации, а не разрешение форматировать диск.')
observe('disk-health', 'Отделить сообщение ядра о пути от сведений накопителя', ['lsblk'],
        'lsblk -n -o NAME,TYPE,TRAN,MODEL; test -d /sys/class/block; printf "guest-data-only\\n"',
        'Сохрани NAME,TYPE,TRAN,MODEL и строку guest-data-only. SMART виртуального диска не доказывает здоровье физического накопителя.')
observe('vm-resources', 'Зафиксировать доступные гостю CPU и лимит памяти', ['lscpu'],
        'lscpu -J; grep "^MemTotal:" /proc/meminfo',
        'Сохрани lscpu -J и MemTotal. Сравни с карточкой ВМ в Proxmox; внутренний сборщик сам не подтверждает конфигурацию хоста.')
observe('pcie', 'Связать PCI-адрес устройства с привязанным драйвером', ['lspci'],
        'lspci -Dnnk', 'Сохрани lspci -Dnnk. Наличие PCI ID и строка Kernel driver in use — разные наблюдения.')
observe('device-id', 'Сопоставить сетевой интерфейс с sysfs и драйвером', ['ip'],
        'for p in /sys/class/net/*; do printf "%s " "${p##*/}"; readlink -f "$p/device/driver" || true; done',
        'Для каждого интерфейса сохрани имя и ссылку на драйвер, если она существует; loopback физического драйвера не имеет.')
observe('uefi', 'Проверить фактический режим загрузки виртуальной машины', ['find'],
        'test -d /sys/firmware/efi; printf "UEFI\\n"; find /sys/firmware/efi/efivars -maxdepth 1 -name "BootOrder-*" -printf "%f\\n"',
        'Нужна ВМ, загруженная через OVMF/UEFI. Сохрани UEFI и имя переменной BootOrder. Отсутствие EFI — отказ предпосылки, не успех.')

# Isolated network stacks. No physical interface or host route is changed.
NET_PREP = '''ip netns add "$NS-a"
ip netns add "$NS-b"
ip link add "$NS-x" type veth peer name "$NS-y"
ip link set "$NS-x" netns "$NS-a"
ip link set "$NS-y" netns "$NS-b"
ip -n "$NS-a" link set "$NS-x" name eth0
ip -n "$NS-b" link set "$NS-y" name eth0
for n in a b; do ip -n "$NS-$n" link set lo up; ip -n "$NS-$n" link set eth0 up; done
ip -n "$NS-a" addr add 192.0.2.1/24 dev eth0
ip -n "$NS-b" addr add 192.0.2.2/24 dev eth0'''
NET_RESTORE = '''for n in a b; do
 if ip netns list | cut -d ' ' -f1 | grep -qx "$NS-$n"; then
  for pid in $(ip netns pids "$NS-$n"); do kill "$pid" 2>/dev/null || true; done
  ip netns del "$NS-$n"
 fi
done'''
lab('address', 'Проверить прямой маршрут между двумя узлами', ['ip','ping'], NET_PREP,
    'ip -n "$NS-a" route get 192.0.2.2 > "$WORK/route.txt"',
    'grep -F "192.0.2.2 dev eth0" "$WORK/route.txt"; ip netns exec "$NS-a" ping -c 1 -W 2 192.0.2.2', NET_RESTORE,
    'Выполни ip -n <NS>-a route get 192.0.2.2 и сохрани вывод в route.txt. Имя NS есть в status.')
lab('prefix', 'Исправить ошибочный префикс и восстановить достижимость', ['ip','ping'],
    NET_PREP+'\nip -n "$NS-a" addr del 192.0.2.1/24 dev eth0; ip -n "$NS-a" addr add 192.0.2.1/32 dev eth0',
    'ip -n "$NS-a" addr del 192.0.2.1/32 dev eth0; ip -n "$NS-a" addr add 192.0.2.1/24 dev eth0',
    'ip -n "$NS-a" -o addr show dev eth0 | grep -F "192.0.2.1/24"; ip netns exec "$NS-a" ping -c 1 -W 2 192.0.2.2', NET_RESTORE,
    'В учебном namespace a замени /32 на /24; не добавляй обходной host route.')
lab('mtu', 'Измерить границу IPv4-пакета без фрагментации', ['ip','ping'],
    NET_PREP+'\nfor n in a b; do ip -n "$NS-$n" link set eth0 mtu "$((1280+VARIANT*100))"; done',
    'printf "%s\\n" "$((1252+VARIANT*100))" > "$WORK/payload.txt"',
    'n=$(cat "$WORK/payload.txt"); test "$n" = "$((1252+VARIANT*100))"; ip netns exec "$NS-a" ping -c 1 -W 2 -M do -s "$n" 192.0.2.2; if ip netns exec "$NS-a" ping -c 1 -W 2 -M do -s "$((n+1))" 192.0.2.2; then exit 1; fi', NET_RESTORE,
    'Найди максимальный payload ping -M do -s в IPv4 и запиши число в payload.txt. Учти 20 байт IPv4 и 8 байт ICMP.')
lab('ipv6', 'Настроить адреса IPv6 и проверить маршрут без DNS', ['ip','ping'], NET_PREP,
    'ip -n "$NS-a" -6 addr add 2001:db8::1/64 dev eth0 nodad; ip -n "$NS-b" -6 addr add 2001:db8::2/64 dev eth0 nodad',
    'ip -n "$NS-a" -6 route get 2001:db8::2; ip netns exec "$NS-a" ping -6 -c 1 -W 2 2001:db8::2',NET_RESTORE,
    'Добавь 2001:db8::1/64 и ::2/64 в два namespace. nodad используется только в этом изолированном опыте.')
lab('firewall', 'Разрешить ICMP в локальном фильтре без смены маршрута', ['ip','ping','nft'],
    NET_PREP+'\nip netns exec "$NS-b" nft add table inet mayak; ip netns exec "$NS-b" nft \'add chain inet mayak input { type filter hook input priority 0; policy drop; }\'',
    'ip netns exec "$NS-b" nft add rule inet mayak input ip protocol icmp accept',
    'ip -n "$NS-a" route get 192.0.2.2; ip netns exec "$NS-a" ping -c 1 -W 2 192.0.2.2; ip netns exec "$NS-b" nft list ruleset | grep -F "policy drop"',NET_RESTORE,
    'Сохрани policy drop; добавь точечное разрешение ICMP в namespace b. Не меняй firewall основной ВМ.')
lab('segments', 'Пропустить трафик через совпадающие VLAN', ['ip','ping'],
    NET_PREP+'\nfor n in a b; do ip -n "$NS-$n" addr flush dev eth0; ip -n "$NS-$n" link add link eth0 name vlan10 type vlan id 10; ip -n "$NS-$n" link set vlan10 up; done\nip -n "$NS-a" addr add 198.51.100.1/24 dev vlan10',
    'ip -n "$NS-b" addr add 198.51.100.2/24 dev vlan10',
    'ip -n "$NS-b" -d link show vlan10 | grep -F "id 10"; ip netns exec "$NS-a" ping -c 1 -W 2 198.51.100.2',NET_RESTORE,
    'Назначь 198.51.100.2/24 интерфейсу vlan10 второго узла. Объясни отличие VLAN ID от IP-префикса.')
lab('tcp', 'Отличить TCP listener от успешного ответа HTTP', ['ip','curl','ss'],
    NET_PREP+'\nprintf "note\\n" > "$WORK/index.html"; ip netns exec "$NS-b" python3 -m http.server 8080 --bind 192.0.2.2 --directory "$WORK" > "$STATE/http.log" 2>&1 &\nsleep 0.5',
    'ip netns exec "$NS-a" curl -fsS --max-time 3 http://192.0.2.2:8080/ > "$WORK/response.txt"',
    'ip netns exec "$NS-b" ss -lnt | grep -F "192.0.2.2:8080"; grep -x note "$WORK/response.txt"; ip netns exec "$NS-a" curl -fsS --max-time 3 http://192.0.2.2:8080/ | grep -x note',NET_RESTORE,
    'Сначала найди listener ss, затем сохрани тело HTTP-ответа в response.txt. Установленное соединение ещё не доказывает правильное содержимое.')

# Real systemd units confined to a transiently named unit, not the learner's real service.
UNIT_PREP = '''test -d /run/systemd/system
python3 -c 'import socket,os; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",int(os.environ["PORT"])))'
printf '[Unit]\\nDescription=Mayak isolated lesson\\n[Service]\\nType=simple\\nUser=%s\\nExecStart=/usr/bin/python3 -m http.server %s --bind 127.0.0.1 --directory %s\\n' "$COURSE_USER" "$PORT" "$WORK" > "/run/systemd/system/$NS.service"
printf 'note\\n' > "$WORK/index.html"
systemctl daemon-reload'''
UNIT_RESTORE='systemctl stop "$NS.service" || true; rm -f "/run/systemd/system/$NS.service"; systemctl daemon-reload; systemctl reset-failed "$NS.service" 2>/dev/null || true'
lab('systemd','Запустить учебную службу и проверить HTTP-ответ',['systemctl','curl'],UNIT_PREP,
    'systemctl start "$NS.service"',
    'systemctl is-active "$NS.service"; for n in $(seq 1 40); do if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/" > "$STATE/body" 2>/dev/null; then break; fi; sleep .1; done; grep -x note "$STATE/body"',UNIT_RESTORE,
    'Узнай NS в status; запусти соответствующий unit и проверь содержимое страницы, а не только active.')
lab('logs','Найти событие своей попытки в системном журнале',['logger','journalctl'],
    'logger -t "$NS" "start attempt $NS"; sleep 0.1; logger -t "$NS" "failure port $((8081+VARIANT))"; journalctl --sync',
    'journalctl -t "$NS" -o cat --no-pager > "$WORK/events.txt"',
    'grep -x "start attempt $NS" "$WORK/events.txt"; grep -x "failure port $((8081+VARIANT))" "$WORK/events.txt"; journalctl -t "$NS" -o cat --no-pager',
    task='Сохрани только сообщения с tag NS в events.txt; найди сначала start, потом failure. Системный журнал при откате не удаляется.')
lab('incident','Восстановить учебную службу и сохранить наблюдение до исправления',['systemctl','curl'],
    UNIT_PREP+'\nsystemctl start "$NS.service"; systemctl stop "$NS.service"',
    'systemctl show "$NS.service" -p ActiveState -p SubState > "$WORK/before.txt"; systemctl start "$NS.service"',
    'grep -x ActiveState=inactive "$WORK/before.txt"; systemctl is-active "$NS.service"; for n in $(seq 1 40); do if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/" > "$STATE/body" 2>/dev/null; then break; fi; sleep .1; done; grep -x note "$STATE/body"',UNIT_RESTORE,
    'До исправления сохрани systemctl show -p ActiveState -p SubState в before.txt. Затем восстанови службу и ответ.')
lab('unknown-incident','Найти неверный адрес прослушивания и восстановить ответ',['systemctl','curl'],
    UNIT_PREP+'\nsed -i s/127.0.0.1/127.0.0.2/ "/run/systemd/system/$NS.service"; systemctl daemon-reload; systemctl start "$NS.service"',
    'systemctl show "$NS.service" -p ExecStart > "$WORK/before.txt"; sed -i s/127.0.0.2/127.0.0.1/ "/run/systemd/system/$NS.service"; systemctl daemon-reload; systemctl restart "$NS.service"',
    'grep -F 127.0.0.2 "$WORK/before.txt"; for n in $(seq 1 40); do if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/" > "$STATE/body" 2>/dev/null; then break; fi; sleep .1; done; grep -x note "$STATE/body"',UNIT_RESTORE,
    'Сохрани ExecStart до изменения в before.txt; восстанови ответ через 127.0.0.1. Не запускай вторую программу в обход службы.')

IMAGE_PREP = '''truncate -s 32M "$STATE/disk.img"
mkfs.ext4 -q -F "$STATE/disk.img"
mkdir "$WORK/mnt"'''
IMAGE_RESTORE = '''if mountpoint -q "$WORK/mnt"; then
 source=$(findmnt -n -o SOURCE --target "$WORK/mnt")
 losetup -j "$STATE/disk.img" | cut -d: -f1 | grep -qx "$source"
 umount "$WORK/mnt"
fi
test -z "$(losetup -j "$STATE/disk.img")"
rm -f "$STATE/disk.img"'''
lab('mount','Подключить только выделенный образ и проверить место записи',['truncate','mkfs.ext4','mount','umount','findmnt','losetup','mountpoint'],IMAGE_PREP,
    'mount -o loop "$STATE/disk.img" "$WORK/mnt"; printf "note\\n" > "$WORK/mnt/note.txt"',
    'mountpoint -q "$WORK/mnt"; source=$(findmnt -n -o SOURCE --target "$WORK/mnt"); losetup -j "$STATE/disk.img" | cut -d: -f1 | grep -qx "$source"; cat "$WORK/mnt/note.txt" | grep -x note',IMAGE_RESTORE,
    'Смонтируй выделенный STATE/disk.img в work/mnt и только после проверки источника запиши note в note.txt.')
lab('filesystem','Различить расход блоков и inode на отдельной ФС',['truncate','mkfs.ext4','mount','umount','findmnt','losetup','mountpoint','df'],
    IMAGE_PREP+'\nmount -o loop "$STATE/disk.img" "$WORK/mnt"; mkdir "$WORK/mnt/notes"; chown "$COURSE_USER:" "$WORK/mnt/notes"',
    'for n in $(seq 1 "$((50+VARIANT*10))"); do touch "$WORK/mnt/notes/n$n"; done; df -B1 "$WORK/mnt" > "$WORK/blocks.txt"; df -i "$WORK/mnt" > "$WORK/inodes.txt"',
    'test "$(find "$WORK/mnt/notes" -type f | wc -l)" = "$((50+VARIANT*10))"; grep -F "$WORK/mnt" "$WORK/blocks.txt"; grep -F "$WORK/mnt" "$WORK/inodes.txt"; df -i "$WORK/mnt"',IMAGE_RESTORE,
    'Создай 50 пустых заметок (60 во втором варианте) в mnt/notes. Сохрани df -B1 в blocks.txt и df -i в inodes.txt; объясни, почему пустые файлы расходуют inode.')

LVM_PREP = '''truncate -s 128M "$STATE/pv.img"
losetup --find --show "$STATE/pv.img" > "$STATE/loop"
dev=$(cat "$STATE/loop")
pvcreate -ff -y "$dev"
vgcreate "$NS" "$dev"
lvcreate -L 16M -n notes "$NS"
mkfs.ext4 -q "/dev/$NS/notes"
mkdir "$WORK/mnt"
mount "/dev/$NS/notes" "$WORK/mnt"
printf 'keep me\\n' > "$WORK/mnt/note.txt"'''
LVM_RESTORE='''if mountpoint -q "$WORK/mnt"; then test "$(readlink -f "$(findmnt -n -o SOURCE --target "$WORK/mnt")")" = "$(readlink -f "/dev/$NS/notes")"; umount "$WORK/mnt"; fi
if vgs "$NS" >/dev/null 2>&1; then vgremove -fy "$NS"; fi
if test -f "$STATE/loop"; then
 dev=$(cat "$STATE/loop")
 if losetup -j "$STATE/pv.img" | cut -d: -f1 | grep -qx "$dev"; then pvremove -fy "$dev"; losetup -d "$dev"; fi
fi
rm -f "$STATE/pv.img" "$STATE/loop"'''
lab('lvm','Расширить LV и файловую систему, сохранив заметку',['truncate','losetup','pvcreate','vgcreate','lvcreate','lvs','vgs','vgremove','pvremove','lvextend','resize2fs','mkfs.ext4','mount','findmnt','mountpoint','umount'],LVM_PREP,
    'lvextend -L "$((32+VARIANT*16))M" "/dev/$NS/notes"; resize2fs "/dev/$NS/notes"',
    '''lvs --noheadings --units b --nosuffix -o lv_size "/dev/$NS/notes" | python3 -c 'import sys,os; assert float(sys.stdin.read())==(32+int(os.environ["VARIANT"])*16)*1024*1024'; python3 -c \'import os; s=os.statvfs(os.environ["WORK"]+"/mnt"); assert s.f_blocks*s.f_frsize>24*1024*1024; print(s.f_blocks*s.f_frsize)\'; grep -x "keep me" "$WORK/mnt/note.txt"''',LVM_RESTORE,
    'Расширь только /dev/NS/notes с 16 до 32 MiB (вариант 1: 48 MiB), затем расширь ext4. Не создавай ФС заново.')

lab('dns','Проверить DNS-ответ собственного изолированного сервера',['ip','dig','dnsmasq'],
    NET_PREP+'\nip netns exec "$NS-b" dnsmasq --keep-in-foreground --port=5353 --no-resolv --no-hosts --bind-interfaces --listen-address=192.0.2.2 --address=/notes.test/192.0.2.2 > "$STATE/dns.log" 2>&1 &\nsleep 0.5',
    'ip netns exec "$NS-a" dig @192.0.2.2 -p 5353 notes.test A +short > "$WORK/address.txt"',
    'grep -x 192.0.2.2 "$WORK/address.txt"; ip netns exec "$NS-a" dig @192.0.2.2 -p 5353 notes.test A +short | grep -x 192.0.2.2',NET_RESTORE,
    'Запроси A-запись notes.test непосредственно у 192.0.2.2:5353 и сохрани только адрес в address.txt. Это ещё не проверка HTTP.')

lab('latency','Посчитать хвост измеренной длительности отдельно от среднего',['runuser'],
    'printf "Use a monotonic clock; measure five real waits.\\n"',
    '''cat > "$WORK/measure.py" <<'PY'
import time,json,statistics,sys
a=[]
for delay in map(float,sys.argv[1:]):
 start=time.monotonic(); time.sleep(delay); a.append((time.monotonic()-start)*1000)
print(json.dumps({'samples_ms':a,'mean_ms':statistics.mean(a),'max_ms':max(a)}))
PY
chown "$COURSE_USER:" "$WORK/measure.py"''',
    '''python3 - <<'PY'
import json,os,statistics,math,subprocess,time
e=os.environ; v=int(e['VARIANT']); delays=[.01,.01,.01,.01,.2+.1*v]; start=time.monotonic()
r=subprocess.run(['runuser','-u',e['COURSE_USER'],'--','python3',e['WORK']+'/measure.py',*map(str,delays)],capture_output=True,text=True,timeout=5)
elapsed=time.monotonic()-start
assert r.returncode==0,r.stderr
a=json.loads(r.stdout); s=a['samples_ms']; assert len(s)==5 and all(math.isfinite(x) and x>0 for x in s)
assert all(x>=d*1000*.9 for x,d in zip(s,delays))
assert abs(a['mean_ms']-statistics.mean(s))<.001 and abs(a['max_ms']-max(s))<.001
assert sum(delays)*.9<=elapsed and sum(s)<=elapsed*1000+20
print(a); print('Observed wall duration:',elapsed)
PY''',
    task='Создай measure.py: для длительностей из sys.argv[1:] измерь каждый sleep монотонными часами и выведи JSON samples_ms, mean_ms, max_ms. Проверка исполнит программу от имени ученика с разными ожиданиями. Готовый JSON без программы не принимается; это не нагрузочный тест сервера.')

lab('ansible-state','Получить одинаковое состояние без изменений при втором запуске',['ansible-playbook','runuser'],
    'printf "%s\\n" "- hosts: localhost" "  connection: local" "  gather_facts: false" "  tasks:" "    - name: Keep note configuration" "      ansible.builtin.copy:" "        content: |" "          port=$((8081+VARIANT))" "        dest: $WORK/service.conf" "        mode: \"0600\"" > "$WORK/site.yml"',
    'runuser -u "$COURSE_USER" -- ansible-playbook -i localhost, "$WORK/site.yml" > "$WORK/first.log"; runuser -u "$COURSE_USER" -- ansible-playbook -i localhost, "$WORK/site.yml" > "$WORK/second.log"',
    'grep -x "port=$((8081+VARIANT))" "$WORK/service.conf"; grep -E "changed=0.*failed=0" "$WORK/second.log"; test "$(stat -c %a "$WORK/service.conf")" = 600',
    task='Прочитай site.yml и запусти дважды с inventory localhost,. Сохрани first.log и second.log; второй запуск должен дать changed=0 и failed=0.')

lab('tls','Отличить доверие сертификату от совпадения имени',['openssl'],
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout "$STATE/key.pem" -out "$WORK/cert.pem" -days 1 -subj /CN=notes.test -addext subjectAltName=DNS:notes.test >/dev/null 2>&1',
    'openssl verify -CAfile "$WORK/cert.pem" -verify_hostname notes.test "$WORK/cert.pem" > "$WORK/valid.txt"; if openssl verify -CAfile "$WORK/cert.pem" -verify_hostname other.test "$WORK/cert.pem" > "$WORK/wrong.txt" 2>&1; then exit 1; fi',
    'openssl verify -CAfile "$WORK/cert.pem" -verify_hostname notes.test "$WORK/cert.pem"; if openssl verify -CAfile "$WORK/cert.pem" -verify_hostname other.test "$WORK/cert.pem"; then exit 1; fi; grep -F "OK" "$WORK/valid.txt"; grep -F "hostname mismatch" "$WORK/wrong.txt"',
    'rm -f "$STATE/key.pem"',
    'Явно доверься только учебному cert.pem через -CAfile. Проверь notes.test и other.test, сохрани valid.txt и wrong.txt. Не меняй системное хранилище CA.')

lab('time','Зафиксировать источник синхронизации и неопределённость времени',['timedatectl'],
    'test -d /run/systemd/system',
    'timedatectl show -p NTPSynchronized -p Timezone > "$WORK/clock.txt"',
    'timedatectl show -p NTPSynchronized -p Timezone > "$STATE/current.txt"; diff -u "$STATE/current.txt" "$WORK/clock.txt"; cat "$STATE/current.txt"',
    task='Сохрани NTPSynchronized и Timezone в clock.txt. Даже yes не задаёт погрешность; если нет измеренной границы ошибки, запиши это ограничение в разборе.')

observe('baseline','Зафиксировать исходную систему перед изменением',['lsblk','ip','sha256sum'],
        'hostname; cat /etc/os-release; lsblk -J -o NAME,TYPE,SIZE; ip -j address show lo; sha256sum /etc/os-release',
        'В observation.txt сохрани hostname, os-release, JSON дисков, JSON loopback и SHA-256 os-release. При изменении сравнивай ту же версию фактов.')

observe('lab-setup','Подтвердить исходное состояние выделенного гостя',['lsblk','ip'],
        'hostname; cat /etc/os-release; lsblk -J -o NAME,TYPE,SIZE; ip -j address show lo',
        'Развёртывание машин выполняется закреплённым course-stand.sh по инструкции главы 0. Внутри выделенного гостя сохрани hostname, os-release, JSON дисков и loopback в observation.txt; сверь карточку с Proxmox.')

lab('mirror','Проверить degraded RAID1 и сохранность заметки',['mdadm','losetup','truncate','mkfs.ext4','mount','mountpoint','umount'],
    '''for n in 1 2; do truncate -s 64M "$STATE/member$n.img"; losetup --find --show "$STATE/member$n.img" > "$STATE/loop$n"; done
test ! -e "/dev/md/$NS"
mdadm --create "/dev/md/$NS" --level=1 --raid-devices=2 --metadata=1.2 --run "$(cat "$STATE/loop1")" "$(cat "$STATE/loop2")"
mdadm --wait "/dev/md/$NS"
mkfs.ext4 -q "/dev/md/$NS"
mkdir "$WORK/mnt"; mount "/dev/md/$NS" "$WORK/mnt"; printf 'keep me\\n' > "$WORK/mnt/note.txt"''',
    'n=$((VARIANT+1)); mdadm "/dev/md/$NS" --fail "$(cat "$STATE/loop$n")" --remove "$(cat "$STATE/loop$n")"',
    'test "$(cat /sys/class/block/$(basename "$(readlink -f "/dev/md/$NS")")/md/degraded)" = 1; grep -x "keep me" "$WORK/mnt/note.txt"; mdadm --detail "/dev/md/$NS"',
    '''if mountpoint -q "$WORK/mnt"; then umount "$WORK/mnt"; fi
if test -e "/dev/md/$NS"; then mdadm --stop "/dev/md/$NS"; fi
for n in 1 2; do
 if test -f "$STATE/loop$n"; then dev=$(cat "$STATE/loop$n"); if losetup -j "$STATE/member$n.img" | cut -d: -f1 | grep -qx "$dev"; then mdadm --zero-superblock "$dev" || true; losetup -d "$dev"; fi; fi
 rm -f "$STATE/member$n.img" "$STATE/loop$n"
done''',
    'Проверь участников по STATE/loop1 и loop2. В варианте 0 выведи первого, в варианте 1 второго. Сохрани доступ к mnt/note.txt. Не затрагивай другие массивы.')

lab('zfs','Перенести снимок в отдельный пул и проверить восстановленный файл',['zpool','zfs','truncate'],
    '''for n in source target; do truncate -s 128M "$STATE/$n.img"; done
zpool create -m "$WORK/source" "${NS}s" "$STATE/source.img"
zpool create -m "$WORK/target" "${NS}t" "$STATE/target.img"
zfs create "${NS}s/notes"
printf 'note variant %s\\n' "$VARIANT" > "$WORK/source/notes/note.txt"
zfs snapshot "${NS}s/notes@baseline"''',
    'zfs send "${NS}s/notes@baseline" | zfs receive "${NS}t/restored"',
    'grep -x "note variant $VARIANT" "$WORK/target/restored/note.txt"; cmp "$WORK/source/notes/note.txt" "$WORK/target/restored/note.txt"; zfs list -t filesystem,snapshot',
    '''for suffix in s t; do
 pool="$NS$suffix"
 if zpool list -H "$pool" >/dev/null 2>&1; then
  if test "$suffix" = s; then image=source; else image=target; fi
  zpool status -P "$pool" | grep -F "$STATE/$image.img"
  zpool destroy "$pool"
 fi
done
rm -f "$STATE/source.img" "$STATE/target.img"''',
    'Передай NSs/notes@baseline в NSt/restored. Прочитай target/restored/note.txt; не используй receive -F для принудительного удаления чужих данных.')

DOCKER_PREP='''docker image inspect python:3.11-slim --format '{{.Id}}' > "$STATE/image-id"
test -z "$(docker ps -aq --filter "name=^/$NS$")"
printf 'note variant %s\\n' "$VARIANT" > "$WORK/index.html"'''
DOCKER_RUN='''docker run -d --pull never --name "$NS" --label "mayak.attempt=$NS" --user "$(id -u "$COURSE_USER"):$(id -g "$COURSE_USER")" --mount "type=bind,source=$WORK,target=/notes,readonly" -p "127.0.0.1:$PORT:8080" "$(cat "$STATE/image-id")" python3 -m http.server 8080 --bind 0.0.0.0 --directory /notes'''
DOCKER_RESTORE='''if docker container inspect "$NS" >/dev/null 2>&1; then test "$(docker inspect --format '{{index .Config.Labels "mayak.attempt"}}' "$NS")" = "$NS"; docker rm -f "$NS"; fi'''
lab('container','Пересоздать контейнер, сохранив заметку вне его слоя',['docker','curl'],
    DOCKER_PREP+'\n'+DOCKER_RUN+'\ndocker inspect --format \'{{.Id}}\' "$NS" > "$STATE/first-container"',
    'docker rm -f "$NS"\n'+DOCKER_RUN,
    '''test "$(docker inspect --format '{{.Id}}' "$NS")" != "$(cat "$STATE/first-container")"
test "$(docker inspect --format '{{.Image}}' "$NS")" = "$(cat "$STATE/image-id")"
docker exec "$NS" cat /notes/index.html | grep -x "note variant $VARIANT"
docker inspect --format '{{json .Mounts}}' "$NS"''',DOCKER_RESTORE,
    'Предварительно нужен локальный python:3.11-slim; исполнитель не скачивает образы. Пересоздай только NS с тем же image ID и bind mount WORK:/notes:ro. Сохрани заметку.')
lab('container-network','Исправить bind внутри контейнера, сохранив локальную публикацию',['docker','curl'],
    DOCKER_PREP+'\n'+DOCKER_RUN.replace('--bind 0.0.0.0','--bind 127.0.0.1'),
    'docker rm -f "$NS"\n'+DOCKER_RUN,
    '''test "$(docker inspect --format '{{.Image}}' "$NS")" = "$(cat "$STATE/image-id")"
docker port "$NS" 8080/tcp | grep -x "127.0.0.1:$PORT"
for n in $(seq 1 30); do if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/" > "$STATE/body"; then break; fi; sleep .1; done
grep -x "note variant $VARIANT" "$STATE/body"''',DOCKER_RESTORE,
    'Предварительно нужен локальный образ python:3.11-slim. Исправь bind программы с 127.0.0.1 на 0.0.0.0 внутри своего контейнера; публикация хоста остаётся на 127.0.0.1.')

KIND_PREP='''test -n "${MAYAK_KIND_NODE_IMAGE:-}"
[[ "$MAYAK_KIND_NODE_IMAGE" =~ ^kindest/node@sha256:[a-f0-9]{64}$ ]]
docker image inspect "$MAYAK_KIND_NODE_IMAGE" >/dev/null
docker image inspect python:3.11-slim >/dev/null
kind create cluster --name "$NS" --image "$MAYAK_KIND_NODE_IMAGE" --kubeconfig "$STATE/kubeconfig" --wait 120s
kind load docker-image python:3.11-slim --name "$NS"
export KUBECONFIG="$STATE/kubeconfig"
kubectl create namespace "$NS"
python3 - <<'PY' > "$STATE/objects.json"
import os,json
n=os.environ['NS']
pod={'containers':[{'name':'notes','image':'python:3.11-slim','imagePullPolicy':'Never','command':['sh','-c','mkdir -p /tmp/web; echo note > /tmp/web/index.html; exec python3 -m http.server 8080 --bind 0.0.0.0 --directory /tmp/web'],'ports':[{'containerPort':8080}],'readinessProbe':{'httpGet':{'path':'/wrong','port':8080},'periodSeconds':1}}]}
deployment={'apiVersion':'apps/v1','kind':'Deployment','metadata':{'name':'notes','namespace':n},'spec':{'replicas':1,'selector':{'matchLabels':{'app':'notes'}},'template':{'metadata':{'labels':{'app':'notes'}},'spec':pod}}}
service={'apiVersion':'v1','kind':'Service','metadata':{'name':'notes','namespace':n},'spec':{'selector':{'app':'notes'},'ports':[{'port':80,'targetPort':8080}]}}
print(json.dumps({'apiVersion':'v1','kind':'List','items':[deployment,service]}))
PY
kubectl apply -f "$STATE/objects.json"'''
KUBE='export KUBECONFIG="$STATE/kubeconfig"\n'
KIND_RESTORE='if kind get clusters | grep -qx "$NS"; then kind delete cluster --name "$NS"; fi\nrm -f "$STATE/kubeconfig" "$STATE/objects.json"'
READINESS_FIX='kubectl -n "$NS" patch deployment notes --type=strategic -p \'{"spec":{"template":{"spec":{"containers":[{"name":"notes","readinessProbe":{"httpGet":{"path":"/","port":8080}}}]}}}}\''
KUBE_CHECK='kubectl -n "$NS" rollout status deployment/notes --timeout=90s; kubectl -n "$NS" exec deployment/notes -- python3 -c \'import urllib.request; r=urllib.request.urlopen("http://notes/").read(); print(r); assert r==b"note\\n"\''
lab('kubernetes','Исправить readiness и подтвердить ответ через Service',['kind','docker','kubectl'],KIND_PREP,
    KUBE+READINESS_FIX,KUBE+KUBE_CHECK,KIND_RESTORE,
    'Нужны заранее загруженные образы kindest/node по digest и python:3.11-slim. Перед prepare передай MAYAK_KIND_NODE_IMAGE. Исправь путь readiness в Deployment своего отдельного кластера. Пробу не удаляй.',timeout=300)
lab('service-selector','Исправить selector Service и подтвердить HTTP-путь',['kind','docker','kubectl'],
    KIND_PREP+'\n'+READINESS_FIX+'\nkubectl -n "$NS" patch service notes -p \'{"spec":{"selector":{"app":"wrong"}}}\'',
    KUBE+'kubectl -n "$NS" patch service notes -p \'{"spec":{"selector":{"app":"notes"}}}\'',
    KUBE+KUBE_CHECK,KIND_RESTORE,
    'Используется отдельный kind-кластер своей попытки, не текущий kube-context. Укажи KUBECONFIG=STATE/kubeconfig. Исправь selector app, сохрани правильный targetPort и readiness.',timeout=300)

lab('cpu-numa','Проверить привязку CPU и размещение страниц на одном NUMA-узле',['numactl','taskset','pgrep','runuser'],
    '''test "$(find /sys/devices/system/node -maxdepth 1 -name 'node[0-9]*' | wc -l)" -ge 2
printf 'Requires two guest-visible NUMA nodes. Physical topology is not certified.\\n' ''',
    '''node=$(find /sys/devices/system/node -maxdepth 1 -name 'node[0-9]*' | sort | head -n1)
n=${node##*node}; cpu=$(cut -d, -f1 "$node/cpulist" | cut -d- -f1)
runuser -u "$COURSE_USER" -- numactl --physcpubind="$cpu" --membind="$n" python3 -c 'import time; a=bytearray(32*1024*1024); time.sleep(120)' "mayak-$NS" >/dev/null 2>&1 &
printf '%s\\n' "$n" > "$WORK/node.txt"; printf '%s\\n' "$cpu" > "$WORK/cpu.txt"
sleep 1
pgrep -f "^python3 -c import time; a=bytearray.*mayak-$NS$" > "$WORK/pid.txt"''',
    '''pid=$(cat "$WORK/pid.txt"); [[ "$pid" =~ ^[0-9]+$ ]]
tr '\\0' ' ' < "/proc/$pid/cmdline" | grep -F "mayak-$NS"
taskset -pc "$pid" | grep -E ": $(cat "$WORK/cpu.txt")$"
node=$(cat "$WORK/node.txt"); [[ "$node" =~ ^[0-9]+$ ]]
grep -E " N$node=[1-9][0-9]+" "/proc/$pid/numa_maps"
cat "/sys/devices/system/node/node$node/cpulist"''',
    'pkill -f "^python3 -c import time; a=bytearray.*mayak-$NS$" || test "$?" = 1',
    'Нужны два NUMA-узла, видимые гостю. Запусти ограниченное выделение 32 MiB с привязкой CPU и памяти к одному узлу; сохрани node.txt, cpu.txt и pid.txt. Одноузловая ВМ не проходит предпосылку.')

lab('network-storage','Записать заметку через выделенный NFS-экспорт',['exportfs','mount.nfs','mount','umount','mountpoint','findmnt','systemctl','runuser'],
    '''systemctl is-active nfs-server.service > "$STATE/nfs-before" || true
mkdir "$WORK/export" "$WORK/client"
chown "$COURSE_USER:" "$WORK/export"
printf 'server note\\n' > "$WORK/export/note.txt"; chown "$COURSE_USER:" "$WORK/export/note.txt"
systemctl start nfs-server.service
exportfs -i -o rw,sync,no_subtree_check,root_squash "127.0.0.1:$WORK/export"''',
    '''mount -t nfs -o vers=4 "127.0.0.1:$WORK/export" "$WORK/client"
runuser -u "$COURSE_USER" -- sh -c 'printf "client note\\n" > "$1/client.txt"' _ "$WORK/client"''',
    'mountpoint -q "$WORK/client"; findmnt -n -o FSTYPE --target "$WORK/client" | grep -E "^nfs4?$"; grep -x "client note" "$WORK/export/client.txt"; cmp "$WORK/client/client.txt" "$WORK/export/client.txt"',
    '''if mountpoint -q "$WORK/client"; then test "$(findmnt -n -o SOURCE --target "$WORK/client")" = "127.0.0.1:$WORK/export"; umount "$WORK/client"; fi
exportfs -u "127.0.0.1:$WORK/export" || true
if test -f "$STATE/nfs-before" && ! grep -qx active "$STATE/nfs-before"; then systemctl stop nfs-server.service; fi''',
    'Пакет nfs-kernel-server должен быть установлен в госте. Подключи только 127.0.0.1:WORK/export в WORK/client, от имени ученика создай client.txt с client note. Это NFS-путь в одной ВМ; отказ независимого сервера данным опытом не проверяется.')

lab('multipath','Проверить программное переключение между двумя путями к одному образу',['dmsetup','losetup','truncate','dd','sha256sum'],
    '''dmsetup targets | grep -q '^multipath '
truncate -s 32M "$STATE/lun.img"
printf 'same logical blocks\\n' | dd of="$STATE/lun.img" conv=notrunc status=none
for n in 1 2; do losetup --find --show "$STATE/lun.img" > "$STATE/path$n"; done
p1=$(cat "$STATE/path1"); p2=$(cat "$STATE/path2")
dmsetup create "$NS" --uuid "mayak-$NS" --table "0 65536 multipath 0 0 1 1 round-robin 0 2 1 $p1 1 $p2 1"
dd if="/dev/mapper/$NS" bs=512 count=1 status=none | sha256sum > "$STATE/before.sha"''',
    'n=$((VARIANT+1)); dmsetup message "$NS" 0 "fail_path $(cat "$STATE/path$n")"; dd if="/dev/mapper/$NS" bs=512 count=1 status=none | sha256sum > "$WORK/after.sha"',
    '''test "$(dmsetup info -c --noheadings -o uuid "$NS" | xargs)" = "mayak-$NS"
dmsetup status "$NS" | grep -E '[[:space:]]F[[:space:]]'
cmp "$STATE/before.sha" "$WORK/after.sha"
dd if="/dev/mapper/$NS" bs=512 count=1 status=none | sha256sum > "$STATE/current.sha"; cmp "$STATE/before.sha" "$STATE/current.sha"''',
    '''if dmsetup info "$NS" >/dev/null 2>&1; then test "$(dmsetup info -c --noheadings -o uuid "$NS" | xargs)" = "mayak-$NS"; dmsetup remove "$NS"; fi
for n in 1 2; do if test -f "$STATE/path$n"; then p=$(cat "$STATE/path$n"); if losetup -j "$STATE/lun.img" | cut -d: -f1 | grep -qx "$p"; then losetup -d "$p"; fi; fi; done
rm -f "$STATE/lun.img" "$STATE/path1" "$STATE/path2"''',
    'Программный опыт DM multipath: два loop-пути ведут к одному файловому образу. Выведи path1 (вариант 1: path2) через dmsetup message fail_path, прочитай те же блоки и сохрани after.sha. Он не доказывает независимость физических HBA, сетей или питания.')
LABS['multipath']['evidenceKind']='software-path-failover'

if __name__ == '__main__':
    Path(__file__).with_name('catalog.json').write_text(json.dumps(
        {'schema': 'mayak-practice-catalog-v1', 'platform': 'Debian 12/13, Python >= 3.11, dedicated guest', 'labs': LABS},
        ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(LABS)} practice recipes authored')
