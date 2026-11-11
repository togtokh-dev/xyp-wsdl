#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# XYP (ХУР) — Ubuntu сервер дээр VPN + клиент тохируулах скрипт
#
# ЭНЭ СКРИПТИЙГ WHITELIST-Д БҮРТГҮҮЛСЭН СЕРВЕР ДЭЭР АЖИЛЛУУЛНА
#
# Хийх зүйл:
#   1. OpenVPN, curl, Node.js суулгах
#   2. .ovpn профайлыг systemd client болгож холбох (auth файлтай)
#   3. xyp.gov.mn → 10.12.0.12 гэж /etc/hosts-д нэмэх
#   4. Node санг суулгаж, WSDL татаж, тест ажиллуулах
#
# Шаардлагатай файлууд (энэ скриптийн хажууд эсвэл --ovpn/--auth-р зааж өгнө):
#   - datacenter.ovpn   (таны .ovpn профайл)
#   - auth.txt          (1-р мөр: нэр, 2-р мөр: нууц үг)
#
# Хэрэглээ:
#   chmod +x deploy/ubuntu-setup.sh
#   sudo ./deploy/ubuntu-setup.sh --ovpn ./datacenter.ovpn --auth ./auth.txt
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

OVPN_SRC=""
AUTH_SRC=""
CONN_NAME="xyp-datacenter"
XYP_HOST_IP="10.12.0.12"
DO_NODE=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ovpn) OVPN_SRC="$2"; shift 2 ;;
    --auth) AUTH_SRC="$2"; shift 2 ;;
    --name) CONN_NAME="$2"; shift 2 ;;
    --no-node) DO_NODE=0; shift ;;
    *) echo "Үл мэдэгдэх аргумент: $1"; exit 1 ;;
  esac
done

# default: скриптийн хажуугийн файлууд
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -z "$OVPN_SRC" && -f "$REPO_DIR/datacenter.ovpn" ]] && OVPN_SRC="$REPO_DIR/datacenter.ovpn"
[[ -z "$AUTH_SRC" && -f "$REPO_DIR/auth.txt" ]] && AUTH_SRC="$REPO_DIR/auth.txt"

if [[ $EUID -ne 0 ]]; then echo "✖ sudo-гоор ажиллуулна уу."; exit 1; fi
if [[ -z "$OVPN_SRC" || ! -f "$OVPN_SRC" ]]; then
  echo "✖ .ovpn олдсонгүй. --ovpn <зам> зааж өгнө үү."; exit 1
fi
if [[ -z "$AUTH_SRC" || ! -f "$AUTH_SRC" ]]; then
  echo "✖ auth.txt олдсонгүй (1-р мөр: нэр, 2-р мөр: нууц үг). --auth <зам> зааж өгнө үү."; exit 1
fi

echo "──────────────────────────────────────────────"
echo " 0. Серверийн гадагшаа гарах IP whitelist-тэй таарч байгаа эсэх"
echo "──────────────────────────────────────────────"
EGRESS_IP="$(curl -s https://api.ipify.org || echo '?')"
echo "   Серверийн egress IP: ${EGRESS_IP}"
echo "   → Энэ нь датацентрт бүртгүүлсэн (whitelist) IP-тэй ТААРАХ ёстой."
echo ""

echo "──────────────────────────────────────────────"
echo " 1. Багц суулгах (openvpn, curl)"
echo "──────────────────────────────────────────────"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq openvpn curl ca-certificates

echo "──────────────────────────────────────────────"
echo " 2. OpenVPN client профайл (systemd)"
echo "──────────────────────────────────────────────"
install -d -m 700 /etc/openvpn/client
CONF="/etc/openvpn/client/${CONN_NAME}.conf"
AUTH_DST="/etc/openvpn/client/${CONN_NAME}.auth"

install -m 600 "$AUTH_SRC" "$AUTH_DST"
# .ovpn-г хуулаад auth-user-pass мөрийг auth файл рүү заана
sed -E "s#^auth-user-pass.*#auth-user-pass ${AUTH_DST}#" "$OVPN_SRC" > "$CONF"
grep -q "^auth-user-pass ${AUTH_DST}$" "$CONF" || echo "auth-user-pass ${AUTH_DST}" >> "$CONF"
chmod 600 "$CONF"
echo "   ✓ $CONF"

systemctl enable "openvpn-client@${CONN_NAME}" >/dev/null 2>&1 || true
systemctl restart "openvpn-client@${CONN_NAME}"
echo "   → Холболт эхлүүллээ. 5 сек хүлээж байна..."
sleep 5

if ip addr show tun0 >/dev/null 2>&1; then
  echo "   ✓ tun0 интерфейс гарч ирлээ (VPN холбогдсон):"
  ip -brief addr show tun0 || true
else
  echo "   ⚠ tun0 алга. Лог:"
  journalctl -u "openvpn-client@${CONN_NAME}" --no-pager -n 20 || true
  echo "   (BYTES_IN=0 / 'poll timeout' бол энэ серверийн IP whitelist-д алга гэсэн үг.)"
fi

echo "──────────────────────────────────────────────"
echo " 3. /etc/hosts — xyp.gov.mn → ${XYP_HOST_IP}"
echo "──────────────────────────────────────────────"
if grep -qE "^\s*[0-9.]+\s+xyp\.gov\.mn" /etc/hosts; then
  sed -i -E "s#^\s*[0-9.]+\s+xyp\.gov\.mn.*#${XYP_HOST_IP}   xyp.gov.mn#" /etc/hosts
else
  echo "${XYP_HOST_IP}   xyp.gov.mn" >> /etc/hosts
fi
echo "   ✓ $(grep 'xyp.gov.mn' /etc/hosts)"

echo "──────────────────────────────────────────────"
echo " 4. xyp.gov.mn:443 хүрэх эсэх (VPN дотроос)"
echo "──────────────────────────────────────────────"
if curl -sk --max-time 10 -o /dev/null -w "   HTTP төлөв: %{http_code}\n" https://xyp.gov.mn/ ; then
  echo "   ✓ xyp.gov.mn хүрч байна."
else
  echo "   ⚠ xyp.gov.mn хүрэхгүй — VPN холбогдоогүй эсвэл hosts буруу."
fi

if [[ "$DO_NODE" == "1" ]]; then
  echo "──────────────────────────────────────────────"
  echo " 5. Node сан — суулгах, WSDL татах, тест"
  echo "──────────────────────────────────────────────"
  if ! command -v node >/dev/null 2>&1; then
    echo "   Node суулгаж байна (NodeSource 20.x)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
  fi
  echo "   node $(node -v), npm $(npm -v)"
  cd "$REPO_DIR"
  sudo -u "${SUDO_USER:-$USER}" npm install
  sudo -u "${SUDO_USER:-$USER}" npm run test:offline || true
  echo "   → WSDL татахыг оролдож байна (бүх endpoint)..."
  sudo -u "${SUDO_USER:-$USER}" npm run download:all || \
    echo "   ⚠ WSDL татагдсангүй — VPN холбогдсон эсэхээ шалгана уу."
fi

echo ""
echo "✔ Дууслаа."
echo "  VPN төлөв:   systemctl status openvpn-client@${CONN_NAME}"
echo "  VPN лог:     journalctl -u openvpn-client@${CONN_NAME} -f"
echo "  Жинхэнэ тест: npm run test:live -- <REGNUM>"
