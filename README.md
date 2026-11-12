# EODHD Portfolio Tracker

Track holdings and transactions, price them live, and copy a real fund's allocation — on your own EODHD key.

![Portfolio Tracker: total value and P&L cards, a positions table with day and total P&L and weights, and allocation by asset type and sector](docs/screenshot.png)

## Run it

```bash
git clone https://github.com/EodHistoricalData/eodhd-portfolio-tracker
cd eodhd-portfolio-tracker
npm ci                    # installs exactly what package-lock.json pins
cp .env.example .env      # Windows cmd: copy .env.example .env
npm start                 # http://localhost:5173
```

Put your EODHD API key in `.env` — [get one here](https://eodhd.com/register?utm_source=eodhd_oss&utm_medium=app&utm_campaign=portfolio-tracker&utm_content=readme).
A free key is enough for your own positions: each is priced from a live quote, one request, so the free plan's twenty requests a day are the limit you will meet first. Fund templates read fundamentals, which need All-In-One or the Fundamentals Data Feed. There is no demo mode: without a key the app tells you so
and does nothing else.

Tested in current Chrome and Firefox on Node 20 and 24. Other browsers
may work but are not tested.

Port 5173 taken (Vite uses it too)? Add `PORT=5174` to `.env` — that works
the same in every shell. A `PORT` already set in your environment wins over
`.env`; change or remove that one instead.

Your key stays in `.env` on your machine. The small server in `server/`
adds it to outgoing requests, so it never reaches the browser and never
appears in a URL. That is also why there is a server at all — `eodhd.com`
does not send CORS headers, so a page cannot call it directly.

`npm test` runs that server's tests on Node's own test runner, with nothing
more to install: the key never reaches the browser, only the feeds these apps
use are forwarded, and a `429` passes its `Retry-After` on to the page.

## Links

The address bar always describes the screen you are on, so copying it gives
somebody else the same screen, and editing it moves the open app there. The
apps keep no history of their own: Back leaves the app rather than stepping
through the screens you visited.

## What it needs from your plan

Positions are priced from EODHD live quotes (stock prices are delayed 15 to 20 minutes), which the free plan includes; its twenty requests a day are the limit you will meet first. The fund templates read holdings from fundamentals, which come with All-In-One and the Fundamentals Data Feed, not with the free plan.

When a request comes back `403`, the app shows you EODHD's own explanation of
what is missing rather than a generic error.

A cold load costs 0 API calls until a portfolio has positions; the free plan has 20 a day. From then on every load prices each position with a live quote, 1 call per symbol, so a five-position portfolio costs about 5 a load. A fund template's holdings come from fundamentals, 10 calls each. The prices per request are EODHD's own:
[API limits](https://eodhd.com/financial-apis/api-limits).

## Known limitations

- Positions cannot be moved between portfolios. Remove the position and add it to the other portfolio.
- A portfolio's base currency is set when it is created and cannot be changed later. Create a new portfolio in the other currency.
## Optional: AI analysis

On first run, a one-line note above the app says it can also analyse what it
shows. Add an OpenAI-compatible key to `.env` and restart, and the analysis
buttons appear:

```bash
OPENAI_API_KEY=sk-...
# AI_BASE_URL=https://api.openai.com/v1   # or Groq, DeepSeek, OpenRouter, local Ollama
# AI_MODEL=gpt-4o-mini
```

The note goes away once the key is set, or with its × (remembered in that
browser). You are billed by your own provider. Without the key everything
else works and the AI buttons are simply not there.

## Support

These are example apps, not a product with an SLA.

- Questions about data, keys or plans → **support@eodhistoricaldata.com**
- Bugs in this code → open an issue, we get to them as time allows
- Pull requests are welcome, and land upstream in our private source
  repository — this repo is generated, so edits made here would be overwritten.
  [CONTRIBUTING.md](CONTRIBUTING.md) says which files are which

## Licence

[MIT](LICENSE.md). Use it, change it, ship it in something you sell — the only
condition is that the copyright notice travels with the code. The same goes for
the two notices that travelled here with the icons: they are Feather and
Lucide, and their licences are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Two things the licence does not cover. It grants no rights in any trademark:
see [TRADEMARK.md](TRADEMARK.md). And it licenses this *code*, not the *data* —
what you may do with what the API returns is governed by your own EODHD
subscription.

---

© Unicorn Data Services · Lyon, France
