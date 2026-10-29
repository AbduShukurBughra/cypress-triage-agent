# cypress-triage-agent

Başarısız Cypress testlerini inceleyen küçük bir QA asistanı. Claude, test
sonuçlarını ve spec dosyalarını okur, gerekirse testi yeniden çalıştırır,
hatanın olası nedenini açıklar ve bir düzeltme önerir. Dosyada yapılacak her
değişikliği önce sen onaylarsın.

Projede ayrıca Cypress giriş testlerinin çalıştığı küçük bir yerel giriş
sayfası var.

## Gereksinimler

- Node.js 20.12 veya üstü (`.env` dosyası `process.loadEnvFile` ile okunuyor; v24 ile test edildi)
- Bir Anthropic API anahtarı ([platform.claude.com](https://platform.claude.com) → API Keys)
- Linux sunucuda başsız (headless) çalıştırmak için Xvfb (`sudo apt install xvfb`)

## Kurulum

```bash
git clone https://github.com/AbduShukurBughra/cypress-triage-agent.git
cd cypress-triage-agent
npm install
cp .env.example .env   # sonra .env içine kendi ANTHROPIC_API_KEY değerini yaz
```

`.env` git tarafından yok sayılır; onu asla commit etme. Commit edilecek dosya
`.env.example`'dır.

## Ajanı çalıştırma

```bash
npm run agent
```

Görev verilmezse varsayılan görev şudur: *"Why are my tests failing? How do I fix them?"*
Kendi görevini de verebilirsin:

```bash
npm run agent -- "login testleri neden başarısız oluyor?"
```

Ajan en fazla 10 tur çalışır (`src/agent.ts` içindeki `MAX_TURNS`).

### Ajanın araçları

| Araç | Ne yapar |
|---|---|
| `get_test_results` | `test-results/results.json` dosyasındaki son test sonuçlarını döndürür |
| `read_file` | Projedeki bir dosyayı okur (`node_modules` hariç) |
| `run_cypress_spec` | `cypress/` altındaki bir spec'i başsız çalıştırır (en fazla 5 dakika) |
| `write_file` | `cypress/` altında bir dosya oluşturur veya değiştirir; önce farkı (diff) gösterir ve onay ister |

Güvenlik kuralları:

- Ajan proje klasörünün dışına çıkamaz.
- Sadece `cypress/` altına yazabilir.
- Her değişikliği terminalde `[y/N]` ile onaylaman gerekir. Terminal yoksa
  (CI, yönlendirilmiş girdi) değişiklik otomatik olarak reddedilir.

> **Not:** `test-results/results.json` kendiliğinden güncellenmez. Ajan buradaki
> eski sonuçları okuyabilir, bu yüzden yeni bir çalıştırmadan sonra dosyayı
> güncel tut.

## Cypress testleri

```bash
npx cypress run --spec cypress/e2e/login.cy.ts   # tek spec
npx cypress run                                  # cypress/e2e/ altındaki tüm spec'ler
```

`cypress.config.ts`, testlerden önce yerel giriş sayfasını
(`cypress/support/login-app.ts`) `http://localhost:3000` adresinde başlatır ve
testler bitince kapatır. Ayrı bir sunucu başlatmana gerek yok. 3000 portu
doluysa başka bir port seç:

```bash
LOGIN_APP_PORT=4000 npx cypress run
```

Yerel giriş sayfası:

| Adres | Davranış |
|---|---|
| `/login` | E-posta ve şifre formu |
| `POST /login` | Doğru bilgilerle `/dashboard`'a yönlendirir, yanlışsa "Invalid credentials" gösterir |
| `/dashboard` | Giriş sonrası sayfa |

Test hesabı `qa@example.com` / `correct-horse`'dur. Sadece bu yerel sayfada
geçerlidir.

> Chrome veya Firefox kurulu değilse Cypress kendi Electron tarayıcısını
> kullanır ve bunun kullanımdan kalkacağı uyarısını gösterir. Chrome kurup
> `--browser chrome` ekleyerek bu uyarıdan kurtulabilirsin.

## Proje yapısı

```
.
├── cypress/
│   ├── e2e/login.cy.ts          # giriş testleri
│   └── support/login-app.ts     # testler için yerel giriş sayfası
├── src/
│   ├── agent.ts                 # ajan döngüsü (Claude Tool Runner)
│   ├── env.ts                   # .env dosyasını yükler
│   └── tools.ts                 # ajanın araçları
├── test-results/results.json    # ajanın okuduğu test sonuçları
├── cypress.config.ts
├── .env.example
└── tsconfig.json
```

## Diğer komutlar

```bash
npm run typecheck   # TypeScript tip kontrolü (src/)
```
