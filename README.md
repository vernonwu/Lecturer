# 🎓 Lecturer

**Turn any PDF slide deck into beautiful, synced lecture notes — powered by AI.**

Want to customize your lecturer? **Now you CAN**!

Upload your slides. Watch notes appear, page by page, in real time. That's it.

---

## 🎬 Demo

<video src="https://github.com/vernonwu/Lecturer/blob/main/media/demo.mp4?raw=true" controls muted playsinline width="100%"></video>

Generated with `gemini-3.1-flash-lite-preview` using default config.  
Source slides can be found [here](media/CS420.pdf).

---

## ✨ What Makes It Special

- 📄 **PDF → Notes, instantly** — Upload any slide deck and get rich Markdown notes generated page by page
- 🔁 **Perfectly in sync** — Scroll the slides, the notes follow. Scroll the notes, the slides follow
- 🧠 **Context-aware** — The AI remembers what it covered earlier so notes stay coherent across the whole deck
- 🔑 **Bring your own key** — Works with OpenAI, Anthropic, Gemini, or any local/custom model
- 📐 **Math & LaTeX support** — Formulas render beautifully out of the box
- 📊 **Live Activity Dashboard** — Floating diagnostics modal with real-time throughput and context-capacity charts
- 🌙 **Dark mode** — Easy on the eyes, day or night
- 📥 **Export anytime** — Copy all notes or download as a `.md` file

---

## 🚀 Getting Started

Try it [here](lecturer.laplacian.net/), or deploy your own in seconds:

**Prerequisites:** Node.js 20+

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and you're in.

---

## 🗺️ How to Use

1. Click **Settings** and drop in your API key + preferred model
2. Upload a `.pdf`
3. Hit **Generate** on a single page — or **Generate Full Document** to do them all
4. Read your notes on the right while the slides track along on the left
5. **Copy** or **Download** your notes when you're done.

---

## 🧭 Dual Context Modes

- **Fast**: starts generation immediately while context mapping runs in the background. Context improves progressively as more slides are mapped.
- **Full**: waits for context mapping across the whole document, then starts generation with complete global context from slide 1.

Use **Fast** for lower startup latency, and **Full** for maximum cross-slide coherence.

---

## ⚙️ Supported AI Providers

| Provider              | Works out of the box |
| --------------------- | -------------------- |
| OpenAI                | ✅                   |
| Anthropic             | ✅                   |
| Google Gemini         | ✅                   |
| Ollama / local models | ✅                   |

Your API key stays in your browser — it's never stored on a server.

---

## 🛠️ Tech Stack

- **Next.js 16** + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **pdf.js** for in-browser PDF rendering
- **KaTeX** for LaTeX math rendering
- **next-themes** for dark mode

---

## 📁 Project Structure

```
src/
  app/               # Routes & API (Edge SSE generation proxy)
  components/        # UI: reader, upload, settings, PDF canvas
  context/           # PDF state & settings (localStorage-backed)
  hooks/             # Streaming consumer, generation queue
  lib/               # PDF processing, settings storage
```

---

## 🤝 Contributing

Contributions are welcome! Fork the repo, make your changes, and open a pull request. Whether it's fixing a bug, improving documentation, or adding a new feature, your help is appreciated.

## 📜 License

MIT — use it, fork it, build on it. Have fun!
