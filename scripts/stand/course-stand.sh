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
WAN_BRIDGE="${STAND_WAN_BRIDGE:-vmbr0}"
STORAGE="${STAND_STORAGE:-local-lvm}"
SNIPPETS="${STAND_SNIPPETS:-local}"
IMAGE_URL="${STAND_IMAGE_URL:-https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2}"
IMAGE_DIR="${STAND_IMAGE_DIR:-/var/lib/vz/template/cache}"
CIUSER="${STAND_USER:-course}"
CIPASS="${STAND_PASSWORD:-}"
SSHKEYS="${STAND_SSHKEYS:-}"
EXTRA_DISKS="${STAND_EXTRA_DISKS:-4}"
EXTRA_DISK_SIZE="${STAND_EXTRA_DISK_SIZE:-8}"
ASSUME_YES="${STAND_YES:-}"
START_AFTER="${STAND_START:-1}"
ROUTER_WAIT="${STAND_ROUTER_WAIT:-60}"

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
  if [ "$DRY" = 1 ]; then printf '  %s\n' "$*"; else say "+ $*"; "$@"; fi
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

ours() { qm config "$1" 2>/dev/null | grep -q "tags:.*${TAG}"; }

busy_ids() {
  local node id out=''
  for node in "${STAND_NODES[@]}"; do
    id=$(vmid_of "$(field "$node" 2)")
    if qm config "$id" >/dev/null 2>&1; then out="$out $id"; fi
  done
  printf '%s' "$out"
}

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
  say "  $WAN_BRIDGE не меняется: на нём живёт управление хостом"
}

make_bridges() {
  local entry name added=0
  for entry in "${STAND_BRIDGES[@]}"; do
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
    printf 'auto %s\niface %s inet manual\n\tbridge-ports none\n\tbridge-stp off\n\tbridge-fd 0\n\n' "$name" "$name" >>/etc/network/interfaces
    say "+ $name добавлен в /etc/network/interfaces"
  done
  if [ "$added" = 1 ]; then
    if command -v ifreload >/dev/null 2>&1; then
      run ifreload -a
    else
      say '! ifreload не найден: примените сетевую конфигурацию вручную'
    fi
  fi
}

# Настройка гостя отдаётся cloud-init. Две вещи сделаны не так, как просит
# документация, и обе — из-за порядка запуска.
#
# Пакеты ставятся не списком packages, а сценарием с ожиданием связи: список
# выполняется один раз и без повторов, а в этот момент router ещё загружается и
# трансляции нет. Гость оставался бы без qemu-guest-agent и tcpdump, и cloud-init
# сообщил бы об ошибке там, куда читатель не смотрит.
#
# Внешний интерфейс router вычисляется по маршруту по умолчанию, а не зашивается
# именем: в гостях Proxmox он называется ens18, а не eth0.
write_snippet() {
  # Два отдельных объявления: в одном local значение $name ещё не присвоено и
  # подставилось бы значение вызывающей функции — с set -u это либо обрыв, либо
  # тихо чужое имя.
  local name="$1"
  local path="/var/lib/vz/snippets/course-stand-$name.yaml"
  mkdir -p /var/lib/vz/snippets
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
      apt-get update
      apt-get install -y qemu-guest-agent curl vim git tcpdump traceroute mtr-tiny dnsutils
      systemctl enable --now qemu-guest-agent
YAML
    if [ "$name" = router ]; then
      cat <<'YAML'
      apt-get install -y nftables
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
    cat <<'YAML'
runcmd:
  - [ sh, -c, '/usr/local/sbin/course-stand-setup' ]
YAML
  } >"$path"
  printf '%s' "$path"
}

node_plan() {
  local node="$1" name offset cores memory disk nets id image
  name=$(field "$node" 1); offset=$(field "$node" 2); cores=$(field "$node" 3)
  memory=$(field "$node" 4); disk=$(field "$node" 5); nets=$(field "$node" 6)
  id=$(vmid_of "$offset"); image=$(image_path)
  head2 "$name (VMID $id)"
  run qm create "$id" --name "$name" --cores "$cores" --memory "$memory" \
    --cpu host --machine q35 --bios ovmf --agent enabled=1 \
    --ostype l26 --scsihw virtio-scsi-single --tags "$TAG"
  run qm set "$id" --efidisk0 "$STORAGE:1,efitype=4m,pre-enrolled-keys=0"
  run qm set "$id" --scsi0 "$STORAGE:0,import-from=$image"
  run qm disk resize "$id" scsi0 "${disk}G"
  # Последовательная консоль добавляется, но экраном по умолчанию не становится:
  # с --vga serial0 кнопка «Console» в веб-интерфейсе показывает пустоту, и
  # читатель, у которого это первый гипервизор, решает, что машина не завелась.
  run qm set "$id" --ide2 "$STORAGE:cloudinit" --boot order=scsi0 --serial0 socket

  local index=0 link bridge address gateway links
  IFS=';' read -r -a links <<<"$nets"
  for link in "${links[@]}"; do
    bridge=${link%%:*}
    address=${link#*:}
    gateway=''
    case "$address" in *,gw=*) gateway=${address##*,gw=}; address=${address%%,gw=*};; esac
    if [ "$bridge" = WAN ]; then bridge="$WAN_BRIDGE"; fi
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

  run qm set "$id" --ciuser "$CIUSER" --nameserver 1.1.1.1 --searchdomain lab
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
      run qm set "$id" "--scsi${slot}" "$STORAGE:${EXTRA_DISK_SIZE},ssd=1,serial=COURSE-DISK-${slot}"
      slot=$(( slot + 1 ))
    done
  fi
  if [ "$START_AFTER" = 1 ]; then
    run qm start "$id"
    # Остальные узлы выходят в сеть только через router, а он в этот момент ещё
    # загружается. Пауза не обязательна — настройка гостя ждёт связи сама, — но
    # без неё пять машин первые минуты стучатся в неподнятую трансляцию.
    if [ "$name" = router ] && [ "$ROUTER_WAIT" -gt 0 ]; then
      if [ "$DRY" = 1 ]; then
        printf '  # пауза %s с: остальные узлы выходят в сеть через router\n' "$ROUTER_WAIT"
      else
        say "= жду $ROUTER_WAIT с, пока router поднимет трансляцию"
        sleep "$ROUTER_WAIT"
      fi
    fi
  fi
}

do_plan() {
  DRY=1
  say 'course-stand · план. Ничего не изменено.'
  say "хранилище $STORAGE · базовый VMID $VMID_BASE · внешний мост $WAN_BRIDGE"
  show_bridges
  head2 'образ гостя'
  say "  $IMAGE_URL"
  say "  → $(image_path) (скачивается один раз и переиспользуется)"
  local node
  for node in "${STAND_NODES[@]}"; do node_plan "$node"; done
  head2 'что дальше'
  if [ -z "$CIPASS" ] && [ -z "$SSHKEYS" ]; then
    say '  ! входить в гостей нечем: задайте STAND_PASSWORD или STAND_SSHKEYS,'
    say '    иначе у пользователя course не будет ни пароля, ни ключа'
  fi
  say '  собрать: та же строка с аргументом create'
  say '  посмотреть: аргумент status · убрать: аргумент destroy'
  say "  скрипт трогает только VMID $VMID_BASE–$(vmid_of 5), мосты vmbr10/20/30 и свои файлы cloud-init"
  say '  всё остальное на хосте остаётся нетронутым'
}

do_create() {
  need_proxmox
  local busy; busy=$(busy_ids)
  if [ -n "$busy" ]; then
    die "идентификаторы заняты:$busy. Уберите прежний стенд (destroy) или задайте STAND_VMID_BASE"
  fi
  pvesm status --storage "$STORAGE" >/dev/null 2>&1 || die "хранилище $STORAGE не найдено: задайте STAND_STORAGE"
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
    die "у хранилища $SNIPPETS не включён тип snippets — он нужен для настройки гостей.
  Включите одной командой и повторите:
    pvesm set $SNIPPETS --content \$(grep -A9 \"^dir: $SNIPPETS\\$\" /etc/pve/storage.cfg | sed -n 's/^[[:space:]]*content //p'),snippets"
  fi
  do_plan
  if [ -z "$ASSUME_YES" ]; then
    printf '\nСоздать перечисленное? Введите yes: '
    local answer; read -r answer
    [ "$answer" = yes ] || die 'отменено'
  fi
  DRY=0
  say ''
  make_bridges
  mkdir -p "$IMAGE_DIR"
  if [ ! -s "$(image_path)" ]; then run curl -fSL --retry 3 -o "$(image_path)" "$IMAGE_URL"; fi
  local node
  for node in "${STAND_NODES[@]}"; do node_plan "$node"; done
  say ''
  say 'Стенд собран. Проверьте его командой status.'
}

do_status() {
  need_proxmox
  local node name id state mine
  printf '%-12s %-6s %-10s %s\n' 'узел' 'vmid' 'состояние' 'наш'
  for node in "${STAND_NODES[@]}"; do
    name=$(field "$node" 1); id=$(vmid_of "$(field "$node" 2)")
    if qm config "$id" >/dev/null 2>&1; then
      state=$(qm status "$id" 2>/dev/null | awk '{print $2}')
      if ours "$id"; then mine=да; else mine=нет; fi
      printf '%-12s %-6s %-10s %s\n' "$name" "$id" "$state" "$mine"
    else
      printf '%-12s %-6s %-10s %s\n' "$name" "$id" 'нет' '-'
    fi
  done
  local entry bridge
  for entry in "${STAND_BRIDGES[@]}"; do
    bridge=$(field "$entry" 1)
    if [ -e "/sys/class/net/$bridge" ]; then state=поднят; else state=нет; fi
    printf '%-12s %s\n' "$bridge" "$state"
  done
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
  say 'Мосты vmbr10/20/30 и строки в /etc/network/interfaces оставлены: к ним'
  say 'могут быть подключены ваши собственные машины. Уберите их вручную —'
  say 'копия файла лежит рядом как /etc/network/interfaces.course-stand.*'
}

case "$ACTION" in
  plan) do_plan ;;
  create) do_create ;;
  status) do_status ;;
  destroy) do_destroy ;;
  *) die "неизвестная команда: $ACTION (plan, create, status, destroy)" ;;
esac
