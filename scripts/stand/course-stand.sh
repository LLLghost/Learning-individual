#!/usr/bin/env bash
# Учебный стенд главы 0 одной командой на хосте Proxmox VE.
#
# Скрипт — единственное место в проекте, которое разворачивает чужую машину
# целиком, поэтому устроен как инжектор работ практикума: показывает план
# прежде действия, трогает только то, что завёл сам, и умеет убрать за собой.
#
#   bash -c "$(curl -fsSL RAW/scripts/stand/course-stand.sh)" -- plan
#   bash -c "$(curl -fsSL RAW/scripts/stand/course-stand.sh)" -- create
#
# Команда по умолчанию — plan: она ничего не меняет и работает где угодно,
# даже не на Proxmox. Прочитайте её вывод прежде, чем запускать create.
set -euo pipefail

TAG='course-stand'
MARK='# course-stand: мосты учебного стенда, добавлено скриптом курса'

# Всё настраиваемое — переменными окружения: одна строка curl не должна
# требовать редактирования файла.
ACTION="${1:-${STAND_ACTION:-plan}}"
VMID_BASE="${STAND_VMID_BASE:-9000}"
WAN_BRIDGE="${STAND_WAN_BRIDGE:-}"
# Внешняя сеть стенда. auto — подключить router к мосту хоста, как в главе 0;
# nat — поднять отдельный мост с трансляцией на самом хосте. Второй режим нужен
# там, где управление живёт не на мосту, а на обычном интерфейсе: подключить к
# нему виртуальную машину нельзя, а перекладывать управляющий интерфейс в мост
# по чужому совету — верный способ потерять доступ к хосту.
WAN_MODE="${STAND_WAN_MODE:-auto}"
NAT_BRIDGE="${STAND_NAT_BRIDGE:-vmbr90}"
NAT_NET="${STAND_NAT_NET:-10.10.90}"
STORAGE="${STAND_STORAGE:-local-lvm}"
SNIPPETS="${STAND_SNIPPETS:-local}"
IMAGE_URL="${STAND_IMAGE_URL:-https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2}"
IMAGE_DIR="${STAND_IMAGE_DIR:-/var/lib/vz/template/cache}"
STAND_ID_FILE="${STAND_ID_FILE:-/etc/course-stand-id}"
STAND_CARD="${STAND_CARD:-/root/course-stand.json}"
CIUSER="${STAND_USER:-course}"
CIPASS="${STAND_PASSWORD:-}"
SSHKEYS="${STAND_SSHKEYS:-}"
EXTRA_DISKS="${STAND_EXTRA_DISKS:-4}"
EXTRA_DISK_SIZE="${STAND_EXTRA_DISK_SIZE:-8}"
ASSUME_YES="${STAND_YES:-}"
START_AFTER="${STAND_START:-1}"
# Сколько ждать готовности router, прежде чем запускать остальные пять машин.
# Это не пауза, а предел ожидания: сборка идёт дальше, как только router
# ответит агентом. Фиксированной паузы в минуту не хватало — и не могло хватать:
# router поднимает трансляцию после установки пакетов, то есть через две-три
# минуты, а гость, запущенный в эту щель, уходит в apt по ещё не работающей
# сети и там зависает (см. wait_router).
ROUTER_WAIT="${STAND_ROUTER_WAIT:-600}"

# Слот SCSI для диска cloud-init. Документация Proxmox советует ide2, и именно
# так стенд не поднимался ни разу: в машине q35 привод ide2 висит на AHCI, а в
# облачном ядре Debian собраны драйверы только виртуальных устройств — диска с
# меткой cidata в госте не появляется вовсе. ds-identify источник данных не
# находит и снимает все юниты cloud-init с этой загрузки. Шесть машин при этом
# загружаются молча и до конца: без имени, без пользователя и без адреса, а
# ошибки нет ни одной — ни в выводе create, ни в журнале гостя. На шине
# корневого диска драйвер поднят ещё в initramfs, и привод виден сразу.
#
# Слот берётся за дисками работ, а не перед ними: иначе донастройка уже
# собранного стенда двигала бы диски главы про RAID, а это чужие данные.
CI_SLOT=$(( EXTRA_DISKS + 1 ))

# Адресный план главы 0. Одна таблица на весь скрипт: разъехавшись с книгой,
# стенд перестаёт отвечать тексту работ, и по выводу этого не увидеть — машины
# поднимутся, просто не те. Валидатор сверяет эту таблицу с таблицей главы.
#   имя|смещение vmid|ядра|память МиБ|диск ГиБ|подключения через «;»
STAND_NODES=(
  'router|0|2|2048|16|WAN:dhcp;vmbr10:10.10.10.1/24;vmbr20:10.10.20.1/24;vmbr30:10.10.30.1/24'
  'linux1|1|2|2048|32|vmbr10:10.10.10.11/24,gw=10.10.10.1'
  'linux2|2|2|2048|32|vmbr20:10.10.20.12/24,gw=10.10.20.1'
  'storage|3|4|4096|32|vmbr20:10.10.20.20/24,gw=10.10.20.1;vmbr30:10.10.30.20/24'
  'monitoring|4|2|4096|40|vmbr20:10.10.20.30/24,gw=10.10.20.1'
  'automation|5|2|2048|32|vmbr20:10.10.20.40/24,gw=10.10.20.1'
)
# Мосты стенда: без физического порта и без адреса — три отдельных коммутатора
# внутри хоста. Внешний мост скрипт не трогает вовсе: на нём живёт управление.
STAND_BRIDGES=('vmbr10|CLIENT-NET' 'vmbr20|SERVER-NET' 'vmbr30|STORAGE-NET')

say() { printf '%s\n' "$*"; }
head2() { printf '\n== %s\n' "$*"; }
die() { printf 'course-stand: %s\n' "$*" >&2; exit 1; }
field() { printf '%s' "$1" | cut -d'|' -f"$2"; }
vmid_of() { printf '%s' $(( VMID_BASE + $1 )); }

# Каждое изменение проходит через одну функцию: в режиме плана она печатает
# команду, в режиме действия выполняет её. Так план не может разойтись с тем,
# что произойдёт на самом деле.
DRY=1
run() {
  if [ "$DRY" = 1 ]; then printf '  %s\n' "$(mask "$@")"; else say "+ $(mask "$@")"; "$@"; fi
}

# Печатается команда, а не выполняется, поэтому пароль в ней скрывается. План
# для того и печатается, чтобы его прочитали и переслали, — а вместе с ним
# уезжал бы и пароль от всех шести машин: в переписку, в историю терминала, в
# вырезку на экране. Выполняется при этом настоящее значение: скрыт только показ.
mask() {
  local arg out='' prev=''
  for arg in "$@"; do
    if [ "$prev" = --cipassword ]; then arg='***'; fi
    prev="$arg"
    out="$out $arg"
  done
  printf '%s' "${out# }"
}

need_proxmox() {
  [ "$(id -u)" = 0 ] || die 'нужны права root на хосте Proxmox'
  for tool in qm pvesm; do
    command -v "$tool" >/dev/null 2>&1 || die "команда $tool не найдена: это не хост Proxmox VE"
  done
  [ -d /etc/pve ] || die 'каталог /etc/pve не найден: это не хост Proxmox VE'
  # qm set --scsi0 …,import-from= появился в Proxmox VE 8.0. На семёрке команда
  # просто не поймёт параметр, и стенд встанет на первой же машине.
  local major
  major=$(pveversion 2>/dev/null | sed -n 's#.*pve-manager/\([0-9]*\)\..*#\1#p')
  if [ -n "$major" ] && [ "$major" -lt 8 ]; then
    die "нужен Proxmox VE 8 или новее: импорт образа диска на $major не поддерживается"
  fi
}

image_path() { printf '%s/%s' "$IMAGE_DIR" "$(basename "$IMAGE_URL")"; }

is_bridge() { [ -d "/sys/class/net/$1/bridge" ]; }

# Мост управления не зашивается именем: vmbr0 — частое, но не обязательное имя,
# а qm set несуществующий мост принимает молча — отказ вылезает только на
# qm start, когда машина уже создана. Берём тот мост, через который у хоста
# идёт маршрут по умолчанию.
detect_wan() {
  if [ -n "$WAN_BRIDGE" ]; then printf '%s' "$WAN_BRIDGE"; return 0; fi
  if [ "$WAN_MODE" = nat ]; then printf '%s' "$NAT_BRIDGE"; return 0; fi
  local guess
  guess=$(uplink)
  if [ -n "$guess" ] && is_bridge "$guess"; then printf '%s' "$guess"; return 0; fi
  printf ''
}

# Proxmox по умолчанию просит cloud-init обновить систему на первой загрузке
# (ciupgrade=1, в user-data это package_upgrade: true). Модуль, который это
# делает, выполняется раньше runcmd, а значит раньше нашего ожидания связи — и
# уходит в apt тогда, когда router ещё не поднял трансляцию. Пойманное на живом
# хосте: apt-get update, начатый за пятнадцать секунд до появления трансляции,
# не отваливается по таймауту, а висит — гость просидел в нём двадцать минут, и
# в это время ни cloud-init, ни наш сценарий не двинулись ни на шаг. Ни create,
# ни журнал хоста об этом не говорят ничего: машина «running», гость молчит.
#
# Поэтому штатный апгрейд выключается, и единственный apt в госте — наш, после
# проверки связи. Параметр появился в Proxmox VE 8.2; на 8.0 и 8.1 его нет, и
# qm set отказал бы. Там, где qm нет вовсе (план на своей машине), считаем, что
# параметр есть: план печатается для сегодняшнего хоста, а не для вчерашнего.
ciupgrade_supported() {
  command -v qm >/dev/null 2>&1 || return 0
  qm help set --verbose 2>/dev/null | grep -q -- '--ciupgrade'
}

# Номер стенда. Работы практикума меняют настройки машины, а метка
# /etc/course-lab-stand одна на всех и лежит по известному пути: сама по себе она
# отличает стенд только от машины, где её забыли завести. Номер кладётся в
# гостей, учебник подставляет его в скачиваемый course_lab.py, и скрипт,
# выпущенный для одного стенда, на другом отказывается работать.
#
# Номер случайный, а не выведенный из хоста: из machine-id он не давал бы ничего
# сверх случайного, зато стал бы отпечатком хоста и уезжал бы в файлах, которые
# читатель пересылает. Заведённый однажды, он переиспользуется: destroy и create
# не должны обесценивать уже скачанные скрипты.
stand_id() {
  if [ -s "$STAND_ID_FILE" ]; then
    tr -dc '0-9a-f' <"$STAND_ID_FILE" | cut -c1-16
    return 0
  fi
  printf ''
}

new_stand_id() {
  local id
  id=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
  printf '%s' "$id"
}

# Заводит номер, если его ещё нет, и пишет карточку — файл, который читатель
# загрузит в учебник. Карточка в JSON, потому что учебник читает JSON; сам номер
# лежит отдельной строкой, потому что его сверяет гость обычным сравнением.
STAND_ID=''
ensure_stand_id() {
  STAND_ID=$(stand_id)
  if [ -n "$STAND_ID" ]; then
    say "= номер стенда $STAND_ID (из $STAND_ID_FILE)"
  elif [ "$DRY" = 1 ]; then
    say "= номер стенда будет заведён при сборке и положен в $STAND_ID_FILE"
    say "  карточка для учебника — $STAND_CARD"
    STAND_ID=''
    return 0
  else
    STAND_ID=$(new_stand_id)
    run sh -c "printf '%s\n' '$STAND_ID' >'$STAND_ID_FILE'"
    say "= номер стенда $STAND_ID заведён"
  fi
  run sh -c "printf '{\"schema\":\"course-stand\",\"stand\":\"%s\"}\n' '$STAND_ID' >'$STAND_CARD'"
  say "  карточка для учебника — $STAND_CARD, загрузите её в кабинете"
}

# Интерфейс хоста с маршрутом по умолчанию: через него уходит трансляция в
# режиме nat и по нему же определяется мост в режиме auto.
uplink() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 route show default 2>/dev/null | awk '{print $5; exit}'
  fi
}

# Поле хранилища из /etc/pve/storage.cfg. Разбор идёт по секциям, а не поиском
# по всему файлу: строка «content» есть у каждого хранилища, и взятая не из той
# секции она даёт список чужих типов.
storage_field() {
  awk -v want="$1" -v key="$2" '
    /^[a-z]+: /{ section = $2; next }
    section == want && $1 == key { print $2; exit }
  ' /etc/pve/storage.cfg 2>/dev/null
}

# Каталог сниппетов берётся из настройки хранилища, а не зашивается: с
# STAND_SNIPPETS на другом хранилище файлы легли бы в /var/lib/vz, а qm искал бы
# их в другом месте — и гость поднялся бы вообще без настройки.
snippet_dir() {
  local base
  base=$(storage_field "$SNIPPETS" path)
  printf '%s/snippets' "${base:-/var/lib/vz}"
}

ours() { qm config "$1" 2>/dev/null | grep -q "tags:.*${TAG}"; }

# Занятые идентификаторы, которые скрипту не принадлежат. Свои машины он
# донастраивает, чужие не трогает вовсе — это единственный вид занятости,
# на котором сборка обязана остановиться.
busy_ids() {
  local node id out=''
  for node in "${STAND_NODES[@]}"; do
    id=$(vmid_of "$(field "$node" 2)")
    if qm config "$id" >/dev/null 2>&1 && ! ours "$id"; then out="$out $id"; fi
  done
  printf '%s' "$out"
}

# Машина уже заведена. Проверка идёт и в плане тоже, поэтому смотрим сначала,
# есть ли вообще qm: план обязан работать и не на Proxmox.
node_exists() { command -v qm >/dev/null 2>&1 && qm config "$1" >/dev/null 2>&1; }

node_running() { [ "$(qm status "$1" 2>/dev/null | awk '{print $2}')" = running ]; }

# Занят ли слот: донастройка не пересоздаёт то, что уже есть.
has_slot() { qm config "$1" 2>/dev/null | grep -q "^$2:"; }

# Слоты, где у машины висит диск cloud-init. Их может оказаться несколько:
# прежняя версия скрипта ставила его на ide2, и оставить оба — значит оставить
# гостю два источника данных, из которых он выберет не тот.
ci_slots() { qm config "$1" 2>/dev/null | awk -F: '/vm-[0-9]+-cloudinit/{print $1}'; }

show_bridges() {
  head2 'мосты стенда'
  local entry name note
  for entry in "${STAND_BRIDGES[@]}"; do
    name=$(field "$entry" 1); note=$(field "$entry" 2)
    if [ -e "/sys/class/net/$name" ]; then
      say "  $name ($note) — уже есть, скрипт его не трогает"
    else
      say "  $name ($note) — bridge-ports none, без адреса, автозапуск"
    fi
  done
  if [ "$WAN_MODE" = nat ]; then
    say "  $NAT_BRIDGE (внешняя сеть с трансляцией) — адрес $NAT_NET.1/24 на хосте, выход через $(uplink)"
    say "  управляющий интерфейс хоста не меняется: на нём живёт ваш доступ"
  elif [ -z "$WAN_BRIDGE" ]; then
    say "  ! моста для внешней сети на хосте нет: маршрут по умолчанию идёт через $(uplink),"
    say "    а это не мост. Задайте STAND_WAN_BRIDGE=имя или STAND_WAN_MODE=nat"
  else
    say "  $WAN_BRIDGE не меняется: на нём живёт управление хостом"
    if [ -e "/sys/class/net/$WAN_BRIDGE" ]; then
      say "  внешний мост найден на хосте"
    else
      say "  ! моста $WAN_BRIDGE на хосте нет — задайте STAND_WAN_BRIDGE"
    fi
  fi
}

nat_stanza() {
  local out
  out=$(uplink)
  [ -n "$out" ] || die 'у хоста нет маршрута по умолчанию: не через что делать трансляцию'
  printf 'auto %s\niface %s inet static\n\taddress %s.1/24\n\tbridge-ports none\n\tbridge-stp off\n\tbridge-fd 0\n\tpost-up echo 1 >/proc/sys/net/ipv4/ip_forward\n\tpost-up iptables -t nat -A POSTROUTING -s %s.0/24 -o %s -j MASQUERADE\n\tpost-down iptables -t nat -D POSTROUTING -s %s.0/24 -o %s -j MASQUERADE\n\n' \
    "$NAT_BRIDGE" "$NAT_BRIDGE" "$NAT_NET" "$NAT_NET" "$out" "$NAT_NET" "$out"
}

make_bridges() {
  local entry name added=0
  local planned=("${STAND_BRIDGES[@]}")
  if [ "$WAN_MODE" = nat ]; then planned+=("$NAT_BRIDGE|внешняя сеть с трансляцией"); fi
  for entry in "${planned[@]}"; do
    name=$(field "$entry" 1)
    if grep -qE "^iface[[:space:]]+$name[[:space:]]" /etc/network/interfaces 2>/dev/null; then
      say "= $name уже описан в /etc/network/interfaces, пропускаю"
      continue
    fi
    if [ "$added" = 0 ]; then
      run cp -a /etc/network/interfaces "/etc/network/interfaces.course-stand.$(date +%Y%m%d%H%M%S)"
      printf '\n%s\n' "$MARK" >>/etc/network/interfaces
      added=1
    fi
    if [ "$name" = "$NAT_BRIDGE" ]; then
      nat_stanza >>/etc/network/interfaces
    else
      printf 'auto %s\niface %s inet manual\n\tbridge-ports none\n\tbridge-stp off\n\tbridge-fd 0\n\n' "$name" "$name" >>/etc/network/interfaces
    fi
    say "+ $name добавлен в /etc/network/interfaces"
  done
  if [ "$added" = 1 ]; then
    if command -v ifreload >/dev/null 2>&1; then
      run ifreload -a
    else
      say '! ifreload не найден: примените сетевую конфигурацию вручную'
    fi
  fi
  # Проверяем результат, а не факт записи в файл: qm set несуществующий мост
  # принимает молча, и отказ всплыл бы только на запуске готовой машины.
  for entry in "${planned[@]}"; do
    name=$(field "$entry" 1)
    [ -e "/sys/class/net/$name" ] || die "мост $name так и не поднялся — примените сетевую конфигурацию и повторите"
  done
}

# Настройка гостя отдаётся cloud-init. Три вещи сделаны не так, как просит
# документация, и все три — из-за порядка запуска.
#
# Пакеты ставятся не списком packages, а сценарием с ожиданием связи: список
# выполняется один раз и без повторов, а в этот момент router ещё загружается и
# трансляции нет. Гость оставался бы без qemu-guest-agent и tcpdump, и cloud-init
# сообщил бы об ошибке там, куда читатель не смотрит.
#
# Агент ставится последним, отдельной командой, и на router — уже после
# трансляции. Ответ агента — единственный признак готовности, по которому судят
# и status, и ожидание перед запуском остальных машин: попади агент в общий
# список пакетов, он отвечал бы с середины настройки, и «гость настроен»
# означало бы «гость на полпути».
#
# Внешний интерфейс router вычисляется по маршруту по умолчанию, а не зашивается
# именем: в гостях Proxmox он называется ens18, а не eth0.
write_snippet() {
  # Два отдельных объявления: в одном local значение $name ещё не присвоено и
  # подставилось бы значение вызывающей функции — с set -u это либо обрыв, либо
  # тихо чужое имя.
  local name="$1"
  local dir
  dir=$(snippet_dir)
  local path="$dir/course-stand-$name.yaml"
  mkdir -p "$dir"
  {
    cat <<'YAML'
#cloud-config
write_files:
  - path: /usr/local/sbin/course-stand-setup
    permissions: '0755'
    content: |
      #!/bin/sh
      # Ждём связи. У пяти узлов она появляется только после того, как router
      # поднимет трансляцию, у самого router есть сразу. Ждём до десяти минут,
      # потом сдаёмся с записью в журнал: молча недонастроенный гость хуже отказа.
      set -u
      ready=0
      i=1
      while [ "$i" -le 60 ]; do
        if getent hosts deb.debian.org >/dev/null 2>&1; then ready=1; break; fi
        sleep 10
        i=$((i + 1))
      done
      if [ "$ready" != 1 ]; then
        echo 'course-stand: сети нет, пакеты не установлены' | systemd-cat -t course-stand -p err
        exit 1
      fi
      export DEBIAN_FRONTEND=noninteractive
      # Таймауты и повторы заданы явно: соединение, начатое в щель между
      # запуском гостя и появлением трансляции, у apt не отваливается само —
      # на живом хосте гость провисел в таком apt-get update двадцать минут.
      apt="apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"
      $apt update
      $apt install -y curl vim git tcpdump traceroute mtr-tiny dnsutils
YAML
    if [ "$name" = router ]; then
      cat <<'YAML'
      $apt install -y nftables
      wan=$(ip -4 route show default | awk '{print $5; exit}')
      [ -n "$wan" ] || { echo 'course-stand: нет маршрута по умолчанию' | systemd-cat -t course-stand -p err; exit 1; }
      echo net.ipv4.ip_forward=1 >/etc/sysctl.d/99-course-stand.conf
      sysctl --system
      nft add table ip nat
      nft add chain ip nat postrouting '{ type nat hook postrouting priority 100 ; }'
      nft add rule ip nat postrouting oifname "$wan" masquerade
      { echo '#!/usr/sbin/nft -f'; echo 'flush ruleset'; nft list ruleset; } >/etc/nftables.conf
      chmod 0755 /etc/nftables.conf
      systemctl enable nftables
YAML
    fi
    # Агент — последней командой сценария: до него настройка ещё идёт, после
    # него она закончена. На router это ещё и означает «трансляция поднята», а
    # именно этого ждёт сборка, прежде чем запускать остальные пять машин.
    cat <<'YAML'
      $apt install -y qemu-guest-agent
      systemctl enable --now qemu-guest-agent
YAML
    # Метка стенда с его номером. Работы практикума меняют машину, на которой
    # их запустили, и отказываются работать без этой метки; номер отличает
    # этот стенд от чужой машины, где метку завели руками.
    if [ -n "$STAND_ID" ]; then
      printf '  - path: /etc/course-lab-stand\n    permissions: %s\n    content: |\n      %s\n' "'0644'" "$STAND_ID"
    fi
    cat <<'YAML'
runcmd:
  - [ sh, -c, '/usr/local/sbin/course-stand-setup' ]
YAML
  } >"$path"
  printf '%s' "$path"
}

# Остальные пять узлов выходят в сеть только через router, поэтому запускать их
# раньше, чем он поднимет трансляцию, нельзя. Фиксированная пауза здесь не
# работает, и живой хост показал почему: router тратит на свою настройку две-три
# минуты, а гость, запущенный в оставшуюся щель, уходит в apt по неработающей
# сети и там зависает насмерть — минутная пауза просто сдвигала щель.
#
# Ждём не время, а признак: агент router отвечает только после того, как
# сценарий гостя поднял трансляцию (он ставится последней командой). Предел
# ожидания есть, но сборка идёт дальше сразу, как только router готов.
wait_router() {
  local id="$1" waited=0
  if [ "$DRY" = 1 ]; then
    printf '  # ждать ответа агента router: трансляция поднята (не дольше %s с)\n' "$ROUTER_WAIT"
    return 0
  fi
  say "= жду router: агент отвечает, когда трансляция поднята (не дольше $ROUTER_WAIT с)"
  while [ "$waited" -lt "$ROUTER_WAIT" ]; do
    if qm agent "$id" ping >/dev/null 2>&1; then
      say "= router готов через $waited с, запускаю остальные машины"
      return 0
    fi
    sleep 10
    waited=$(( waited + 10 ))
  done
  # Не отказ: стенд собирается дальше, а гости ждут связи сами. Но сказать об
  # этом надо здесь, а не оставлять читателя гадать, почему пусто в status.
  say "! router не ответил за $ROUTER_WAIT с — остальные узлы будут ждать связи сами."
  say "  Посмотрите его консоль: qm terminal $id, внутри journalctl -t course-stand -b"
}

node_plan() {
  local node="$1" name offset cores memory disk nets id image
  name=$(field "$node" 1); offset=$(field "$node" 2); cores=$(field "$node" 3)
  memory=$(field "$node" 4); disk=$(field "$node" 5); nets=$(field "$node" 6)
  id=$(vmid_of "$offset"); image=$(image_path)
  head2 "$name (VMID $id)"
  # Уже заведённую машину скрипт не пересоздаёт: он накладывает на неё
  # настройку и оставляет диск с системой в покое. Так чинится стенд, собранный
  # прежней версией скрипта, и так же переживается прерванная сборка — повторный
  # запуск доводит до конца то, что успело завестись.
  local known=0
  if node_exists "$id"; then known=1; fi
  if [ "$known" = 1 ]; then
    say '  машина уже есть — донастраиваю, диск с системой не трогаю'
    # Настройка накладывается на остановленной машине: cloud-init читает свой
    # диск при загрузке, и правка на ходу до гостя не доехала бы.
    if node_running "$id"; then run qm shutdown "$id" --timeout 60 --forceStop 1; fi
    local stale
    for stale in $(ci_slots "$id"); do
      if [ "$stale" = "scsi${CI_SLOT}" ]; then continue; fi
      say "  диск cloud-init стоит в слоте $stale — переношу"
      run qm set "$id" --delete "$stale"
    done
  else
    run qm create "$id" --name "$name" --cores "$cores" --memory "$memory" \
      --cpu host --machine q35 --bios ovmf --agent enabled=1 \
      --ostype l26 --scsihw virtio-scsi-single --tags "$TAG"
    run qm set "$id" --efidisk0 "$STORAGE:1,efitype=4m,pre-enrolled-keys=0"
    run qm set "$id" --scsi0 "$STORAGE:0,import-from=$image"
    run qm disk resize "$id" scsi0 "${disk}G"
  fi
  # Последовательная консоль добавляется, но экраном по умолчанию не становится:
  # с --vga serial0 кнопка «Console» в веб-интерфейсе показывает пустоту, и
  # читатель, у которого это первый гипервизор, решает, что машина не завелась.
  if ! has_slot "$id" "scsi${CI_SLOT}"; then
    run qm set "$id" "--scsi${CI_SLOT}" "$STORAGE:cloudinit"
  fi
  run qm set "$id" --boot order=scsi0 --serial0 socket

  local index=0 link bridge address gateway links
  IFS=';' read -r -a links <<<"$nets"
  for link in "${links[@]}"; do
    bridge=${link%%:*}
    address=${link#*:}
    gateway=''
    case "$address" in *,gw=*) gateway=${address##*,gw=}; address=${address%%,gw=*};; esac
    if [ "$bridge" = WAN ]; then
      bridge="$WAN_BRIDGE"
      # В режиме трансляции внешняя сеть своя, и адрес в ней статический:
      # выдавать его некому, DHCP-сервера на этом мосту нет.
      if [ "$WAN_MODE" = nat ] && [ "$address" = dhcp ]; then
        address="$NAT_NET.2/24"; gateway="$NAT_NET.1"
      fi
    fi
    run qm set "$id" "--net${index}" "virtio,bridge=$bridge"
    if [ "$address" = dhcp ]; then
      run qm set "$id" "--ipconfig${index}" 'ip=dhcp'
    elif [ -n "$gateway" ]; then
      run qm set "$id" "--ipconfig${index}" "ip=$address,gw=$gateway"
    else
      run qm set "$id" "--ipconfig${index}" "ip=$address"
    fi
    index=$(( index + 1 ))
  done

  local ciopts=(--ciuser "$CIUSER" --nameserver 1.1.1.1 --searchdomain lab)
  # Штатный апгрейд выключается: он идёт раньше нашего ожидания связи и вешает
  # гостя в apt по ещё не работающей сети (см. ciupgrade_supported).
  if [ -n "$CIUPGRADE" ]; then ciopts+=(--ciupgrade 0); fi
  run qm set "$id" "${ciopts[@]}"
  if [ -n "$CIPASS" ]; then run qm set "$id" --cipassword "$CIPASS"; fi
  if [ -n "$SSHKEYS" ]; then run qm set "$id" --sshkeys "$SSHKEYS"; fi
  if [ "$DRY" = 1 ]; then
    run qm set "$id" --cicustom "vendor=$SNIPPETS:snippets/course-stand-$name.yaml"
  else
    run qm set "$id" --cicustom "vendor=$SNIPPETS:snippets/$(basename "$(write_snippet "$name")")"
  fi

  # Диски для глав про RAID, LVM и multipath: без них работы этих глав выполнять
  # не на чем, а добавить их задним числом читателю неоткуда.
  if [ "$name" = storage ] && [ "$EXTRA_DISKS" -gt 0 ]; then
    local slot=1
    while [ "$slot" -le "$EXTRA_DISKS" ]; do
      # Уже заведённый диск не трогаем: донастройка не должна пересоздавать то,
      # на чём читатель мог собрать массив.
      if has_slot "$id" "scsi${slot}"; then
        say "  scsi${slot} уже есть — оставляю как есть"
      else
        # Кроме серийного номера диску задаётся WWN, и вот почему. Книга учит
        # адресовать диски по /dev/disk/by-id, потому что буквы sd* между
        # загрузками переставляются — на этом самом стенде они переставлялись
        # при каждой перезагрузке storage. Но udev берёт идентификатор со
        # страницы VPD 0x83, куда QEMU кладёт имя слота, а не серийный номер со
        # страницы 0x80: без WWN в by-id лежат ссылки вида
        # scsi-0QEMU_QEMU_HARDDISK_drive-scsi1 — имя слота, то есть ровно то,
        # чего упражнение про устойчивые имена избегает. Серийник при этом
        # виден в lsblk, и расхождения не заметить, пока не выполнишь ls by-id.
        run qm set "$id" "--scsi${slot}" "$STORAGE:${EXTRA_DISK_SIZE},ssd=1,serial=COURSE-DISK-${slot},wwn=0x$(printf '%016x' $(( 0x5000c0de00000000 + slot )))"
      fi
      slot=$(( slot + 1 ))
    done
  fi
  if [ "$START_AFTER" = 1 ]; then
    run qm start "$id"
    if [ "$name" = router ] && [ "$ROUTER_WAIT" -gt 0 ]; then wait_router "$id"; fi
  fi
}

do_plan() {
  DRY=1
  say 'course-stand · план. Ничего не изменено.'
  say "хранилище $STORAGE · базовый VMID $VMID_BASE · внешняя сеть: ${WAN_BRIDGE:-не найдена}${WAN_MODE:+ · режим $WAN_MODE}"
  show_bridges
  head2 'образ гостя'
  say "  $IMAGE_URL"
  say "  → $(image_path) (скачивается один раз и переиспользуется)"
  head2 'номер стенда'
  ensure_stand_id
  local node
  for node in "${STAND_NODES[@]}"; do node_plan "$node"; done
  head2 'что дальше'
  if [ -z "$CIPASS" ] && [ -z "$SSHKEYS" ]; then
    say '  ! входить в гостей нечем: задайте STAND_PASSWORD или STAND_SSHKEYS,'
    say '    иначе у пользователя course не будет ни пароля, ни ключа'
  fi
  say '  собрать: та же строка с аргументом create'
  say '  посмотреть: аргумент status · убрать: аргумент destroy'
  # Список того, что изменится, собирается из тех же данных, что и сами
  # действия. Перечисленный рукой, он отставал от кода: в режиме трансляции
  # скрипт заводит ещё один мост и правило на хосте, а строка об этом молчала —
  # и молчала ровно там, где читатель решает, нажимать ли yes.
  local touched=''
  for entry in "${STAND_BRIDGES[@]}"; do touched="$touched, $(field "$entry" 1)"; done
  say "  скрипт трогает только VMID $VMID_BASE–$(vmid_of 5), мосты${touched#,} и свои файлы cloud-init"
  if [ "$WAN_MODE" = nat ]; then
    say "  плюс мост $NAT_BRIDGE: адрес $NAT_NET.1/24 на хосте, пересылка и правило трансляции через $(uplink)"
  fi
  say '  уже заведённые машины стенда пересоздаваться не будут: им достанется только настройка'
  say '  всё остальное на хосте остаётся нетронутым'
}

do_create() {
  need_proxmox
  local busy; busy=$(busy_ids)
  if [ -n "$busy" ]; then
    die "идентификаторы заняты чужими машинами:$busy. Скрипт их не трогает —
  уберите их сами или задайте STAND_VMID_BASE. Свои машины он донастраивает."
  fi
  pvesm status --storage "$STORAGE" >/dev/null 2>&1 || die "хранилище $STORAGE не найдено: задайте STAND_STORAGE"
  # Отсутствующий мост управления обнаруживается до создания машин: qm set
  # принимает любое имя, и первая же машина упала бы уже на qm start.
  if [ "$WAN_MODE" != nat ] && ! is_bridge "$WAN_BRIDGE"; then
    local bridges=''
    for interface in /sys/class/net/*; do
      is_bridge "$(basename "$interface")" && bridges="$bridges $(basename "$interface")"
    done
    die "моста $WAN_BRIDGE на хосте нет, подключить внешний интерфейс router не к чему.
  Мосты хоста:$bridges
  Маршрут по умолчанию идёт через $(uplink) — если это не мост, есть два пути:
    STAND_WAN_MODE=nat — поднять отдельный мост $NAT_BRIDGE с трансляцией на хосте;
                         управляющий интерфейс при этом не трогается вовсе
    STAND_WAN_BRIDGE=имя — указать существующий мост, если он у вас есть"
  fi
  # Без пароля и без ключа у пользователя course нет ни того, ни другого: в
  # консоль Proxmox он тоже не войдёт. Шесть машин поднимутся и окажутся
  # недоступны — а это ровно тот случай, ради которого скрипт и писался.
  if [ -z "$CIPASS" ] && [ -z "$SSHKEYS" ]; then
    die "нечем входить в гостей: задайте пароль или ключ, иначе машины поднимутся недоступными.
    STAND_PASSWORD='пароль' bash -c \"\$(curl -fsSL …)\" -- create
    STAND_SSHKEYS=/root/.ssh/id_ed25519.pub bash -c \"\$(curl -fsSL …)\" -- create"
  fi
  # Чужую настройку хранилища скрипт не правит: он говорит, какой командой её
  # расширить, и останавливается.
  if ! pvesm status --storage "$SNIPPETS" --content snippets >/dev/null 2>&1; then
    # Команда печатается готовой, со списком типов этого хранилища. Первая
    # версия печатала её с подстановкой $(…): у читателя она разворачивалась в
    # несколько слов, и pvesm отвечал «too many arguments».
    local content
    content=$(storage_field "$SNIPPETS" content)
    if [ -n "$content" ]; then
      die "у хранилища $SNIPPETS не включён тип snippets — он нужен для настройки гостей.
  Включите одной командой и повторите:
    pvesm set $SNIPPETS --content $content,snippets"
    fi
    die "у хранилища $SNIPPETS не включён тип snippets — он нужен для настройки гостей.
  Список типов у него не записан в /etc/pve/storage.cfg явно. Добавьте Snippets
  в «Datacenter → Storage → $SNIPPETS → Content» и повторите, либо укажите другое
  хранилище: STAND_SNIPPETS=имя"
  fi
  do_plan
  if [ -z "$ASSUME_YES" ]; then
    printf '\nСоздать перечисленное? Введите yes: '
    local answer; read -r answer
    [ "$answer" = yes ] || die 'отменено'
  fi
  DRY=0
  # Прерванная на середине сборка оставляет недоделанную машину, и следующий
  # запуск упрётся в занятый идентификатор. Говорим об этом сразу, а не оставляем
  # читателя разбираться с непонятным отказом.
  trap 'say ""; say "Сборка прервана. Недоделанные машины стенда убираются аргументом destroy."' EXIT
  say ''
  make_bridges
  ensure_stand_id
  mkdir -p "$IMAGE_DIR"
  if [ ! -s "$(image_path)" ]; then run curl -fSL --retry 3 -o "$(image_path)" "$IMAGE_URL"; fi
  local node
  for node in "${STAND_NODES[@]}"; do node_plan "$node"; done
  say ''
  trap - EXIT
  say 'Стенд собран. Проверьте его командой status.'
}

do_status() {
  need_proxmox
  # «running» говорит лишь то, что процесс машины жив, — про готовность гостя
  # оно не говорит ничего, ровно как «Up» у контейнера в главе 22. Настройка
  # гостя заканчивается установкой агента, поэтому ответ агента и есть признак
  # того, что гость настроился, а не просто включился.
  local node name id state mine ready here
  here=$(stand_id)
  if [ -n "$here" ]; then
    say "номер стенда $here · карточка для учебника $STAND_CARD"
  else
    say "номер стенда не заведён: его создаёт create"
  fi
  say ''
  printf '%-12s %-6s %-10s %-5s %s\n' 'узел' 'vmid' 'состояние' 'наш' 'гость настроен'
  for node in "${STAND_NODES[@]}"; do
    name=$(field "$node" 1); id=$(vmid_of "$(field "$node" 2)")
    if ! qm config "$id" >/dev/null 2>&1; then
      printf '%-12s %-6s %-10s %-5s %s\n' "$name" "$id" 'нет' '-' '-'
      continue
    fi
    state=$(qm status "$id" 2>/dev/null | awk '{print $2}')
    if ours "$id"; then mine=да; else mine=нет; fi
    if qm agent "$id" ping >/dev/null 2>&1; then ready='да'; else ready='ещё нет'; fi
    printf '%-12s %-6s %-10s %-5s %s\n' "$name" "$id" "$state" "$mine" "$ready"
  done
  # Мосты берутся из того же списка, что и при сборке: перечисленные руками, они
  # умолчали бы про мост трансляции — тот самый, без которого стенд без сети.
  local entry bridge shown=("${STAND_BRIDGES[@]}")
  if [ "$WAN_MODE" = nat ]; then shown+=("$NAT_BRIDGE|внешняя сеть с трансляцией"); fi
  printf '\n'
  for entry in "${shown[@]}"; do
    bridge=$(field "$entry" 1)
    if [ -e "/sys/class/net/$bridge" ]; then state=поднят; else state=нет; fi
    printf '%-12s %s\n' "$bridge" "$state"
  done
  printf '\n'
  say 'Гость настраивается после запуска: ждёт связи через router, ставит пакеты,'
  say 'последним включает агента. Первые минуты «ещё нет» — это нормально.'
  say 'Если не проходит долго: qm terminal <vmid>, внутри journalctl -t course-stand -b'
}

# Убирает только машины со своей меткой. Машина без метки под тем же номером —
# чужая: её не трогаем и говорим об этом вслух.
do_destroy() {
  need_proxmox
  if [ -z "$ASSUME_YES" ]; then
    printf 'Удалить виртуальные машины стенда с меткой %s? Введите yes: ' "$TAG"
    local answer; read -r answer
    [ "$answer" = yes ] || die 'отменено'
  fi
  DRY=0
  local node name id
  for node in "${STAND_NODES[@]}"; do
    name=$(field "$node" 1); id=$(vmid_of "$(field "$node" 2)")
    if ! qm config "$id" >/dev/null 2>&1; then say "= $name ($id) нет"; continue; fi
    if ! ours "$id"; then say "! $id без метки $TAG — это не наша машина, пропускаю"; continue; fi
    if qm status "$id" 2>/dev/null | grep -q running; then run qm stop "$id"; fi
    run qm destroy "$id" --purge
  done
  say ''
  say 'Мосты стенда и строки в /etc/network/interfaces оставлены: к ним'
  say 'могут быть подключены ваши собственные машины. Уберите их вручную —'
  say 'копия файла лежит рядом как /etc/network/interfaces.course-stand.*'
}

# Имя моста управления вычисляется после объявления функций и до первой команды.
WAN_BRIDGE=$(detect_wan)
# Спрашиваем хост один раз: qm help разбирает всю схему и идёт заметно дольше
# самих qm set, а ответ один на все шесть машин.
CIUPGRADE=''
if ciupgrade_supported; then CIUPGRADE=1; fi

case "$ACTION" in
  plan) do_plan ;;
  create) do_create ;;
  status) do_status ;;
  destroy) do_destroy ;;
  *) die "неизвестная команда: $ACTION (plan, create, status, destroy)" ;;
esac
