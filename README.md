# xyp-wsdl

XYP (ХУР) төрийн мэдээлэл солилцооны систем рүү **Node.js / TypeScript**-ээр SOAP
хүсэлт илгээх сан. Онцлог:

- 🔐 **Гарын үсэг автоматаар** — RSA-SHA256 (`accessToken.timeStamp`), хүсэлт бүрд шинэ
- 🌐 **Олон endpoint** — `citizen`, `insurance`, `transport`, `statistic` … домэйн бүрт тусдаа WSDL
- ⬇️ **WSDL татагч** — `xsd:import`-уудыг рекурсивээр дагаж локал болгоно
- 🧪 **Офлайн тест** — VPN-гүйгээр гарын үсэг + WSDL парсыг шалгана

```
src/
  signature.ts   RSA-SHA256 гарын үсэг (accessToken.timeStamp)
  tls.ts         CA / https.Agent тохиргоо
  endpoints.ts   домэйн → WSDL endpoint (endpoints.json)
  client.ts      XypClient — soap клиентийн wrapper
  config.ts      .env уншина
  index.ts       export
scripts/
  download-wsdl.ts   WSDL + XSD import-уудыг рекурсивээр татна
test/
  signature.test.ts   офлайн unit тест (VPN шаардахгүй)
  wsdl-parse.test.ts   офлайн: WSDL татаж, парс хийж шалгана
  citizen.live.ts      жинхэнэ дуудлага (VPN + эрх шаардана)
wsdl/<domain>/          татсан WSDL-ууд
endpoints.json          домэйнуудын жагсаалт
deploy/ubuntu-setup.sh  сервер дээр VPN + клиент тохируулах
```

---

## 1. Суулгах

```bash
npm install
```

Скриптүүд `tsx`-ээр шууд ажиллана (build шаардахгүй). Нийтлэхдээ `npm run build`
(→ `dist/`).

## 2. ⚠️ VPN + IP whitelist (хамгийн чухал)

XYP-ийн `xyp.gov.mn` endpoint нь **зөвхөн VPN**-ээр холбогдоно. Датацентр нь таны
**гадаад IP**-г firewall-д бүртгэж (whitelist) байж л холболт зөвшөөрнө.

Дараалал (developer.xyp.gov.mn/docs/guide):

1. **Гэрээ** — Цахим Хөгжил, Инновац, Харилцаа Холбооны яамтай.
2. **PGP түлхүүр** — https://pgp.datacenter.gov.mn/ дээр бүртгэнэ (бүх имэйл PGP-ээр).
3. **VPN хүсэлт** — `security@datacenter.gov.mn` рүү: гадаад IP, байгууллагын мэдээлэл.
   Хариуд: эрх, сертификат, **username/password + .ovpn**.
4. **OpenVPN** суулгаж холбоно (UDP 1194). Клиент: https://vpn.datacenter.gov.mn:943
5. **hosts**: `xyp.gov.mn`-ийг олгогдсон дотоод IP (жишээ: `10.12.0.12`) рүү заана.

> **Холболт TLS timeout өгч, лог дээр хариу (BYTES_IN) ирэхгүй бол** → таны IP
> whitelist-д идэвхжээгүй гэсэн үг (сертификат/нууц үгийн асуудал БИШ). Серверийн
> egress IP (`curl ifconfig.me`) нь бүртгүүлсэн IP-тэй **таарч** байх ёстой.
> Иймд клиентийг **whitelist-д бүртгүүлсэн сервер дээрээ** ажиллуул
> ([deploy хэсэг](#7-ubuntu-сервер-дээр-deploy-хийх)).

### Сертификат (TLS алдаа гарвал)
- Root **MNRCA-2021** — https://esign.gov.mn/MNRCA.zip → Trusted Root
- Intermediate **MNICA-2021/2022** — https://esign.gov.mn/MNICA.zip → Intermediate
- Эсвэл түр зуур `.env`-д `XYP_CA_FILE=<ca.pem>` / `XYP_INSECURE_TLS=1` (зөвхөн локал).

## 3. Тохиргоо (.env)

```bash
cp .env.example .env
```

`.env`-д дараахыг бөглөнө (жинхэнэ утгыг git-д **хэзээ ч** оруулахгүй):

| Хувьсагч | Утга |
|---|---|
| `XYP_ACCESS_TOKEN` | байгууллагад олгогдсон токен |
| `XYP_PRIVATE_KEY_PATH` | RSA хувийн түлхүүрийн зам (`./keys/private.pem`) |
| `XYP_HOST` | `https://xyp.gov.mn` |
| `XYP_VERSION` | `1.5.0` |
| `XYP_DOMAIN` | live тестийн домэйн (`citizen` гм) |

## 4. Endpoint-ууд

Домэйн бүр тусдаа WSDL-тэй. `endpoints.json`-д удирдана:

```json
{
  "host": "https://xyp.gov.mn",
  "version": "1.5.0",
  "endpoints": [
    { "name": "citizen",   "ns": "http://citizen.xyp.gov.mn/" },
    { "name": "insurance", "ns": "http://insurance.xyp.gov.mn/" }
  ]
}
```

URL загвар: `<host>/<domain>-<version>/ws?WSDL`
(жишээ: `https://xyp.gov.mn/citizen-1.5.0/ws?WSDL`).

## 5. WSDL татах

VPN холбогдсоны дараа:

```bash
npm run download:all        # endpoints.json доторх бүгд → wsdl/<domain>/
# эсвэл нэг домэйн:
npm run download:wsdl -- https://xyp.gov.mn/citizen-1.5.0/ws?WSDL
```

`xsd:import` / `schemaLocation`-ийг дагаж татаад, лавлагааг локал нэр рүү дахин
холбоно. Ингэснээр VPN-гүй ч локал файлаар клиент үүсгэж тест хийж болно.

## 6. Тест

```bash
npm run test:offline                 # VPN шаардахгүй (гарын үсэг + WSDL парс)
npm run test:live -- УБ99112233      # жинхэнэ дуудлага (VPN + .env шаардана)
```

### Кодоос ашиглах

```ts
import { XypClient, loadConfig } from 'xyp-wsdl';

const cfg = loadConfig();
const client = await XypClient.create({ ...cfg, domain: 'citizen' });

const { result } = await client.call('WS100101_getCitizenIDCardInfo', {
  request: { regnum: 'УБ99112233', auth: { citizen: { authType: '', otp: '' } } },
});
console.log(result);
```

Операц бүрд `accessToken`, `timeStamp`, `signature` header **автоматаар шинээр**
үүснэ (replay-аас сэргийлж timeStamp бүрд шинэ гарын үсэг).

#### Аутентификацийн төрөл (authType)

| Утга | Арга | Талбарууд |
|------|------|-----------|
| 1 | OTP | otp, regnum |
| 2 | Тоон гарын үсэг | signature, certFingerprint, regnum |
| 3 | Хурууны хээ | fingerprint, regnum |
| 4 | SSO OTP | otp, regnum |
| 5 | ДАН апп | regnum |

## 7. Ubuntu сервер дээр deploy хийх

VPN нь whitelist-д бүртгүүлсэн IP-тэй сервер дээр л холбогдоно:

```bash
git clone <repo> xyp-wsdl && cd xyp-wsdl

# .ovpn болон auth файлаа байрлуулах (git-д ОРОХГҮЙ):
#   - datacenter.ovpn   (таны профайл)
#   - auth.txt          (1-р мөр: нэр, 2-р мөр: нууц үг — deploy/auth.txt.example)

chmod +x deploy/ubuntu-setup.sh
sudo ./deploy/ubuntu-setup.sh --ovpn ./datacenter.ovpn --auth ./auth.txt
```

Скрипт: OpenVPN суулгаж, systemd client болгон холбож, `xyp.gov.mn → 10.12.0.12`
hosts-д нэмж, Node санг суулгаад WSDL татаж тест хийнэ.

```bash
# egress IP whitelist-тэй таарч байгааг шалгах:
curl ifconfig.me          # → бүртгүүлсэн IP байх ёстой

# VPN төлөв/лог:
systemctl status openvpn-client@xyp-datacenter
journalctl -u openvpn-client@xyp-datacenter -f
```

> **Нэг хэрэглэгч = нэг холболт.** `.ovpn` нь нэг username-д түгжээтэй тул хоёр
> сервер зэрэг холбогдвол нэг нь нөгөөгөө салгана. Хэд хэдэн сервер бол нэмэлт
> сертификат авна.

## 8. Аюулгүй байдал

- Жинхэнэ `accessToken`, нууц үг, хувийн түлхүүр, `.ovpn`, `auth.txt`-ийг **хэзээ ч**
  git-д оруулж болохгүй — эдгээр нь `.gitignore`-д орсон.
- `.env.example`, `deploy/auth.txt.example` нь зөвхөн **placeholder** агуулна.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (бүх процессод) ашиглахаас зайлсхий — CA суулга.

## Лавлагаа

- Гарын авлага: https://developer.xyp.gov.mn/docs/guide
- Үйлчилгээний жагсаалт (v1.5.0, 483 үйлчилгээ): https://developer.xyp.gov.mn/docs/1.5.0/services

## License

MIT
