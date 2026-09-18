#!/usr/bin/env bash
# Подставной хост для scripts/stand/course-stand.sh.
#
# Скрипт стенда меняет чужую машину, а проверить его до сих пор было можно
# только на настоящем Proxmox. Половина дефектов, которые он собрал за время
# работы, настоящего хоста не требовала вовсе: необъявленное имя во втором поле
# одного local под set -u, список вида «[ … ] && команда» с ложным условием,
# пустой import-from из-за заголовка в подстановке, съехавшая нумерация слотов,
# пароль в напечатанной команде. Всё это видно на подставных qm и pvesm.
#
# Чего здесь нет и быть не может: qm set, молча принимающий несуществующий мост;
# облачное ядро, не видящее привод; cloud-init, уходящий в apt по мёртвой сети.
# Такое ловится только живым хостом — для него есть task-local-proxmox.md.
#
#   bash scripts/stand/selftest.sh
set -euo pipefail

STAND="$(cd "$(dirname "$0")" && pwd)/course-stand.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASSED=0
FAILED=0

# ---------- подставной хост ----------

mkdir -p "$WORK/bin"

# qm ведёт себя по переменным, а каждый вызов записывает в журнал: так
# проверяется главное свойство плана — что он не выполняет ни одной команды,
# меняющей состояние.
cat >"$WORK/bin/qm" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >>"$STUB_LOG"
case "$1" in
  config)
    case " ${STUB_EXISTING:-} " in
      *" $2 "*) ;;
      *) exit 1 ;;
    esac
    printf 'name: node-%s\n' "$2"
    printf 'boot: order=scsi0\n'
    printf 'scsi0: local-lvm:vm-%s-disk-1,size=16G\n' "$2"
    if [ -n "${STUB_CI_SLOT:-}" ]; then
      printf '%s: local-lvm:vm-%s-cloudinit,media=cdrom\n' "$STUB_CI_SLOT" "$2"
    fi
    if [ -n "${STUB_LAB_DISKS:-}" ]; then
      printf 'scsi1: local-lvm:vm-%s-disk-2,size=8G\n' "$2"
    fi
    case " ${STUB_FOREIGN:-} " in
      *" $2 "*) ;;
      *) printf 'tags: course-stand\n' ;;
    esac
    ;;
  status) printf 'status: %s\n' "${STUB_RUNNING:-stopped}" ;;
  help) if [ -n "${STUB_CIUPGRADE:-}" ]; then printf '  --ciupgrade <boolean>\n'; fi ;;
  agent) exit 1 ;;
esac
exit 0
STUB

cat >"$WORK/bin/pvesm" <<'STUB'
#!/bin/sh
printf 'pvesm %s\n' "$*" >>"$STUB_LOG"
exit 0
STUB

# Маршрут по умолчанию через обычный интерфейс, а не через мост: именно так
# выглядел настоящий хост, на котором стенд впервые не собрался.
cat >"$WORK/bin/ip" <<'STUB'
#!/bin/sh
case "$*" in
  *"route show default"*) printf 'default via 10.0.0.1 dev nic0\n' ;;
esac
exit 0
STUB

chmod +x "$WORK/bin/qm" "$WORK/bin/pvesm" "$WORK/bin/ip"

# ---------- прогон и утверждения ----------

OUT=''
LOG=''

# Запускает план с подставным хостом. Переменные передаются аргументами вида
# ИМЯ=значение; всё остальное окружение у прогона своё.
plan() {
  LOG="$WORK/calls.log"
  : >"$LOG"
  OUT=$(env PATH="$WORK/bin:$PATH" STUB_LOG="$LOG" "$@" bash "$STAND" plan 2>&1) || {
    printf '  ОШИБКА: план завершился с кодом %s\n%s\n' "$?" "$OUT"
    FAILED=$(( FAILED + 1 ))
    return 0
  }
}

case_name() { printf '\n== %s\n' "$*"; }

ok() { PASSED=$(( PASSED + 1 )); printf '  ok   %s\n' "$1"; }
bad() { FAILED=$(( FAILED + 1 )); printf '  ПЛОХО %s\n' "$1"; }

expect() {
  if printf '%s' "$OUT" | grep -qF -- "$2"; then ok "$1"; else
    bad "$1"
    printf '       ожидалось в выводе: %s\n' "$2"
  fi
}

expect_not() {
  if printf '%s' "$OUT" | grep -qF -- "$2"; then
    bad "$1"
    printf '       не должно быть в выводе: %s\n' "$2"
  else ok "$1"; fi
}

expect_no_call() {
  if grep -qE "$2" "$LOG"; then
    bad "$1"
    printf '       план выполнил: %s\n' "$(grep -E "$2" "$LOG" | head -1)"
  else ok "$1"; fi
}

# ---------- случаи ----------

case_name 'синтаксис'
if bash -n "$STAND"; then ok 'скрипт разбирается'; else bad 'скрипт разбирается'; fi

case_name 'план по умолчанию ничего не меняет'
LOG="$WORK/calls.log"; : >"$LOG"
OUT=$(env PATH="$WORK/bin:$PATH" STUB_LOG="$LOG" bash "$STAND" 2>&1)
expect 'без аргумента выполняется план' 'план. Ничего не изменено'
# Самое важное свойство: план печатает команды, а не выполняет их. Стоит
# кому-нибудь обойти функцию run — и читатель, запустивший plan, получит стенд.
expect_no_call 'план не создаёт машин' '^create '
expect_no_call 'план не правит настройку машин' '^set '
expect_no_call 'план не запускает машин' '^start '
expect_no_call 'план не удаляет машин' '^destroy '

case_name 'шесть узлов с адресами из плана главы 0'
plan STAND_WAN_BRIDGE=vmbr0
for node in router:9000 linux1:9001 linux2:9002 storage:9003 monitoring:9004 automation:9005; do
  expect "заводится ${node%%:*}" "qm create ${node##*:} --name ${node%%:*}"
done
expect 'адрес linux1' '--ipconfig0 ip=10.10.10.11/24,gw=10.10.10.1'
expect 'адрес linux2' '--ipconfig0 ip=10.10.20.12/24,gw=10.10.20.1'
expect 'первый адрес storage' '--ipconfig0 ip=10.10.20.20/24,gw=10.10.20.1'
expect 'второй адрес storage без шлюза' '--ipconfig1 ip=10.10.30.20/24'
expect 'адрес monitoring' '--ipconfig0 ip=10.10.20.30/24,gw=10.10.20.1'
expect 'адрес automation' '--ipconfig0 ip=10.10.20.40/24,gw=10.10.20.1'
expect 'маршрутизатор в сети клиентов' '--net1 virtio,bridge=vmbr10'

case_name 'диск cloud-init на шине корневого диска, а не на ide2'
plan STAND_WAN_BRIDGE=vmbr0
expect 'диск cloud-init на SCSI' '--scsi5 local-lvm:cloudinit'
expect_not 'привод ide2 не используется' '--ide2'

case_name 'учебные диски: серийный номер и WWN'
plan STAND_WAN_BRIDGE=vmbr0
expect 'первый диск' '--scsi1 local-lvm:8,ssd=1,serial=COURSE-DISK-1,wwn=0x5000c0de00000001'
expect 'четвёртый диск' '--scsi4 local-lvm:8,ssd=1,serial=COURSE-DISK-4,wwn=0x5000c0de00000004'

case_name 'слот cloud-init считается от числа учебных дисков'
plan STAND_WAN_BRIDGE=vmbr0 STAND_EXTRA_DISKS=0
expect 'без учебных дисков диск cloud-init встаёт первым' '--scsi1 local-lvm:cloudinit'
expect_not 'учебных дисков нет' 'COURSE-DISK-1'

case_name 'пароль не печатается'
plan STAND_WAN_BRIDGE=vmbr0 STAND_PASSWORD=hunter2
expect 'пароль скрыт' '--cipassword ***'
expect_not 'пароль не виден в плане' 'hunter2'

case_name 'штатный апгрейд cloud-init выключается'
plan STAND_WAN_BRIDGE=vmbr0 STUB_CIUPGRADE=1
expect 'на хосте с параметром апгрейд выключён' '--ciupgrade 0'
plan STAND_WAN_BRIDGE=vmbr0
expect_not 'на хосте без параметра его не подставляют' '--ciupgrade'

case_name 'сборка ждёт готовности маршрутизатора, а не времени'
plan STAND_WAN_BRIDGE=vmbr0
expect 'ждём ответа агента' 'ждать ответа агента router'
expect_not 'слепой паузы нет' 'пауза 60 с'

case_name 'хост без моста наружу: режим трансляции'
plan STAND_WAN_MODE=nat
expect 'заводится мост трансляции' 'vmbr90'
expect 'адрес моста на хосте' '10.10.90.1/24'
expect 'внешний интерфейс маршрутизатора в этом мосту' '--net0 virtio,bridge=vmbr90'
expect 'статический адрес вместо DHCP' '--ipconfig0 ip=10.10.90.2/24,gw=10.10.90.1'
expect 'управляющий интерфейс не трогается' 'управляющий интерфейс хоста не меняется'

case_name 'хост без моста наружу и без режима трансляции: предупреждение'
plan
expect 'план называет причину' 'моста для внешней сети на хосте нет'
expect 'план называет оба выхода' 'STAND_WAN_MODE=nat'

case_name 'своя машина донастраивается, а не пересоздаётся'
plan STAND_WAN_BRIDGE=vmbr0 STUB_EXISTING=9000 STUB_CI_SLOT=ide2 STUB_RUNNING=running
expect 'машина узнана своей' 'машина уже есть — донастраиваю'
expect_not 'машина не создаётся заново' 'qm create 9000'
expect 'диск cloud-init переносится из прежнего слота' 'qm set 9000 --delete ide2'
expect 'диск cloud-init встаёт в нужный слот' 'qm set 9000 --scsi5 local-lvm:cloudinit'
expect 'работающая машина останавливается на время правки' 'qm shutdown 9000'
expect 'и запускается снова' 'qm start 9000'

case_name 'диски работ существующей машины не пересоздаются'
plan STAND_WAN_BRIDGE=vmbr0 STUB_EXISTING=9003 STUB_LAB_DISKS=1
expect 'занятый слот оставлен как есть' 'scsi1 уже есть'
expect_not 'диск не пересоздаётся' 'serial=COURSE-DISK-1'

case_name 'предупреждение, когда входить в гостей нечем'
plan STAND_WAN_BRIDGE=vmbr0
expect 'план говорит о пароле и ключе' 'входить в гостей нечем'

printf '\n%s\n' '----------------------------------------'
printf 'Проверок пройдено: %s, не пройдено: %s\n' "$PASSED" "$FAILED"
[ "$FAILED" = 0 ] || exit 1
