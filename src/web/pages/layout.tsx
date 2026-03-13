import type { Child } from "hono/jsx";

export function Layout({ children, title }: { children: Child; title?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title ?? "Contact Intelligence"}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --color-bg: #0A1628;
            --color-surface: #111827;
            --color-surface-elevated: #1F2937;
            --color-surface-hover: #374151;
            --color-accent: #0E7F88;
            --color-accent-hover: #009F93;
            --color-accent-glow: rgba(14,127,136,0.2);
            --color-accent-subtle: rgba(14,127,136,0.1);
            --color-text: #F9FAFB;
            --color-text-secondary: #9CA3AF;
            --color-text-muted: #6B7280;
            --color-border: rgba(255,255,255,0.08);
            --color-border-strong: rgba(255,255,255,0.15);
            --visma-green: #0E7F88;
            --visma-turquoise: #009F93;
            --visma-lime: #8CB501;
            --visma-orange: #F97C00;
            --visma-coral: #EF564B;
            --visma-yellow: #F4CD4E;
            --visma-red: #E70641;
            --font-body: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif;
            --font-mono: "JetBrains Mono", monospace;
            --space-xs: 0.5rem;
            --space-sm: 1rem;
            --space-md: 1.5rem;
            --space-lg: 2.5rem;
            --space-xl: 4rem;
            --radius-sm: 6px;
            --radius-md: 10px;
            --radius-lg: 16px;
            --radius-xl: 20px;
            --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
          }

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: var(--font-body);
            background: var(--color-bg);
            color: var(--color-text);
            min-height: 100vh;
            overflow: hidden;
          }

          .app-header {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            border-bottom: 1px solid var(--color-border);
            background: var(--color-surface);
            height: 56px;
          }

          .app-badge {
            background: linear-gradient(135deg, var(--visma-turquoise), var(--visma-green));
            color: white;
            font-weight: 800;
            font-size: 0.85rem;
            padding: 0.3rem 0.6rem;
            border-radius: var(--radius-sm);
            letter-spacing: 0.05em;
          }

          .app-title {
            font-family: var(--font-mono);
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--color-text-secondary);
          }

          .app-nav {
            display: flex;
            gap: 0.25rem;
            margin-left: auto;
          }

          .nav-btn {
            font-family: var(--font-mono);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 0.3rem 0.6rem;
            border-radius: var(--radius-sm);
            border: 1px solid var(--color-border);
            background: transparent;
            color: var(--color-text-muted);
            cursor: pointer;
            transition: all 0.15s;
          }

          .nav-btn:hover {
            border-color: var(--color-accent);
            color: var(--color-text-secondary);
          }

          .app-body {
            display: flex;
            height: calc(100vh - 56px);
          }

          .chat-panel {
            width: 35%;
            min-width: 320px;
            max-width: 480px;
            border-right: 1px solid var(--color-border);
            display: flex;
            flex-direction: column;
            background: var(--color-surface);
          }

          .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-md);
            display: flex;
            flex-direction: column;
            gap: var(--space-sm);
          }

          .chat-msg {
            padding: var(--space-xs) var(--space-sm);
            border-radius: var(--radius-md);
            font-size: 0.9rem;
            line-height: 1.6;
            max-width: 90%;
          }

          .chat-msg.user {
            background: var(--color-accent-subtle);
            border: 1px solid rgba(14,127,136,0.3);
            align-self: flex-end;
            color: var(--color-text);
          }

          .chat-msg.assistant {
            background: var(--color-surface-elevated);
            border: 1px solid var(--color-border);
            align-self: flex-start;
            color: var(--color-text-secondary);
          }

          .chat-input-area {
            padding: var(--space-sm);
            border-top: 1px solid var(--color-border);
            position: relative;
          }

          [x-cloak] { display: none !important; }

          .slash-dropdown {
            position: absolute;
            bottom: 100%;
            left: var(--space-sm);
            right: var(--space-sm);
            background: var(--color-surface-elevated);
            border: 1px solid var(--color-border-strong);
            border-radius: var(--radius-md);
            padding: 0.35rem;
            margin-bottom: 0.35rem;
            max-height: 260px;
            overflow-y: auto;
            z-index: 50;
          }

          .slash-option {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: 0.5rem 0.65rem;
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: background 0.1s;
          }

          .slash-option:hover,
          .slash-option-active {
            background: var(--color-surface-hover);
          }

          .slash-cmd {
            font-family: var(--font-mono);
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--visma-turquoise);
            white-space: nowrap;
          }

          .slash-desc {
            font-size: 0.8rem;
            color: var(--color-text-muted);
          }

          /* Activity Tabs */
          .activity-tabs {
            display: flex;
            gap: 2px;
            margin-bottom: var(--space-sm);
            border-bottom: 1px solid var(--color-border);
            padding-bottom: 0;
          }

          .activity-tab {
            font-family: var(--font-mono);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            padding: 0.5rem 0.75rem;
            color: var(--color-text-muted);
            cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: color 0.15s, border-color 0.15s;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            background: none;
            border-top: none;
            border-left: none;
            border-right: none;
          }

          .activity-tab:hover {
            color: var(--color-text-secondary);
          }

          .activity-tab-active {
            color: var(--visma-turquoise);
            border-bottom-color: var(--visma-turquoise);
          }

          .tab-count {
            font-size: 0.65rem;
            background: var(--color-surface-hover);
            padding: 0.1rem 0.4rem;
            border-radius: 100px;
            min-width: 1.2rem;
            text-align: center;
          }

          .activity-tab-active .tab-count {
            background: rgba(0,159,147,0.2);
          }

          .chat-form {
            display: flex;
            gap: var(--space-xs);
          }

          .chat-input {
            flex: 1;
            background: var(--color-surface-elevated);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: 0.75rem 1rem;
            color: var(--color-text);
            font-family: var(--font-body);
            font-size: 0.9rem;
            outline: none;
            transition: border-color 0.2s var(--ease-out);
          }

          .chat-input:focus {
            border-color: var(--color-accent);
          }

          .chat-input::placeholder {
            color: var(--color-text-muted);
          }

          .chat-submit {
            background: var(--visma-green);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            padding: 0.75rem 1.25rem;
            font-weight: 600;
            font-size: 0.85rem;
            cursor: pointer;
            transition: background 0.2s var(--ease-out);
          }

          .chat-submit:hover { background: var(--visma-turquoise); }

          .canvas-panel {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-md);
          }

          .card {
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-xl);
            padding: var(--space-lg);
            margin-bottom: var(--space-md);
            transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
          }

          .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          }

          .card-clickable { cursor: pointer; }

          .card-title {
            font-size: 1.15rem;
            font-weight: 700;
            line-height: 1.4;
            letter-spacing: -0.01em;
            margin-bottom: var(--space-xs);
          }

          .card-label {
            font-family: var(--font-mono);
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--color-text-muted);
          }

          .badge {
            font-family: var(--font-mono);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            padding: 0.25rem 0.6rem;
            border-radius: 100px;
            font-weight: 600;
            display: inline-block;
          }

          .badge-turquoise { background: rgba(0,159,147,0.15); color: #009F93; }
          .badge-orange { background: rgba(249,124,0,0.15); color: #F97C00; }
          .badge-lime { background: rgba(140,181,1,0.15); color: #8CB501; }
          .badge-coral { background: rgba(239,86,75,0.15); color: #EF564B; }
          .badge-yellow { background: rgba(244,205,78,0.15); color: #F4CD4E; }
          .badge-green { background: rgba(14,127,136,0.15); color: #0E7F88; }

          .stat-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: var(--space-sm);
            margin-bottom: var(--space-md);
          }

          .stat-box {
            background: var(--color-surface-elevated);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--space-sm);
            text-align: center;
            transition: border-color 0.15s, background 0.15s;
          }

          .stat-box.card-clickable:hover {
            border-color: var(--color-accent);
            background: var(--color-surface-hover);
          }

          .stat-value {
            font-size: 2rem;
            font-weight: 800;
            color: var(--visma-green);
            line-height: 1.1;
          }

          .stat-label {
            font-family: var(--font-mono);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--color-text-muted);
            margin-top: 0.35rem;
          }

          .score-bar {
            height: 6px;
            background: var(--color-surface-elevated);
            border-radius: 3px;
            overflow: hidden;
          }

          .score-bar-fill {
            height: 100%;
            border-radius: 3px;
            background: linear-gradient(90deg, var(--visma-turquoise), var(--visma-green));
            transition: width 0.4s var(--ease-out);
          }

          .table-row {
            display: flex;
            align-items: center;
            padding: 0.75rem 0;
            border-bottom: 1px solid var(--color-border);
            gap: var(--space-sm);
          }

          .table-row:last-child { border-bottom: none; }

          .table-row:hover { background: var(--color-surface-elevated); margin: 0 calc(-1 * var(--space-sm)); padding-left: var(--space-sm); padding-right: var(--space-sm); border-radius: var(--radius-sm); }

          .timeline-item {
            display: flex;
            gap: var(--space-sm);
            padding: 0.75rem 0;
            border-bottom: 1px solid var(--color-border);
          }

          .timeline-item:last-child { border-bottom: none; }

          .timeline-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-top: 6px;
            flex-shrink: 0;
          }

          .section-title {
            font-size: 1.35rem;
            font-weight: 700;
            line-height: 1.3;
            letter-spacing: -0.01em;
            margin-bottom: var(--space-sm);
          }

          .text-secondary { color: var(--color-text-secondary); }
          .text-muted { color: var(--color-text-muted); }
          .text-sm { font-size: 0.85rem; }
          .text-xs { font-size: 0.75rem; }
          .font-mono { font-family: var(--font-mono); }
          .mt-sm { margin-top: var(--space-sm); }
          .mt-md { margin-top: var(--space-md); }
          .mb-sm { margin-bottom: var(--space-sm); }
          .mb-xs { margin-bottom: var(--space-xs); }
          .flex { display: flex; }
          .flex-col { flex-direction: column; }
          .items-center { align-items: center; }
          .justify-between { justify-content: space-between; }
          .gap-xs { gap: var(--space-xs); }
          .gap-sm { gap: var(--space-sm); }
          .flex-1 { flex: 1; }

          .empty-state {
            text-align: center;
            padding: var(--space-xl);
            color: var(--color-text-muted);
          }

          .empty-state-icon {
            font-size: 3rem;
            margin-bottom: var(--space-sm);
            opacity: 0.3;
          }

          .period-btn { font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.35rem 0.7rem; border-radius: 100px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-muted); cursor: pointer; transition: all 0.15s; }
          .period-btn:hover { border-color: var(--color-accent); color: var(--color-text-secondary); }
          .period-btn-active { background: rgba(0,159,147,0.15); border-color: var(--visma-turquoise); color: var(--visma-turquoise); }

          .editable-field { display: inline-flex; align-items: center; }
          .editable-display { cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.1rem 0.3rem; border-radius: var(--radius-sm); transition: background 0.15s; }
          .editable-display:hover { background: var(--color-surface-elevated); }
          .edit-icon { font-size: 0.7rem; opacity: 0; transition: opacity 0.15s; color: var(--color-text-muted); }
          .editable-display:hover .edit-icon { opacity: 0.7; }
          .editable-input { background: var(--color-surface-elevated); border: 1px solid var(--color-accent); border-radius: var(--radius-sm); padding: 0.2rem 0.4rem; color: var(--color-text); font-family: var(--font-body); font-size: inherit; outline: none; min-width: 4rem; }

          /* htmx loading states */
          .htmx-request { opacity: 0.6; pointer-events: none; }
          .htmx-request .btn-label { display: none; }
          .htmx-request .btn-loading { display: inline; }
          .btn-loading { display: none; }

          @keyframes spin { to { transform: rotate(360deg); } }
          .htmx-indicator { display: none; }
          .htmx-request .htmx-indicator,
          .htmx-request.htmx-indicator { display: inline-block; }
          .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--color-text-muted); border-top-color: var(--visma-turquoise); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }

          a { color: var(--color-accent); text-decoration: none; }
          a:hover { color: var(--color-accent-hover); }

          /* Scrollbar */
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: var(--color-surface-hover); border-radius: 3px; }

          /* Form elements for message writer */
          .input {
            background: var(--color-bg);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            color: var(--color-text);
            padding: var(--space-xs);
            font-family: inherit;
            font-size: 0.875rem;
          }
          .input:focus {
            outline: none;
            border-color: var(--visma-turquoise);
          }
          .btn {
            padding: var(--space-xs) var(--space-sm);
            border-radius: var(--radius-sm);
            border: 1px solid var(--color-border);
            background: var(--color-bg-card);
            color: var(--color-text);
            cursor: pointer;
            font-size: 0.8rem;
            font-family: inherit;
          }
          .btn:hover { border-color: var(--visma-turquoise); }
          .btn-sm { padding: 4px 8px; font-size: 0.75rem; }
          .btn-primary {
            background: var(--visma-turquoise);
            color: var(--color-bg);
            border-color: var(--visma-turquoise);
            font-weight: 600;
          }
          .btn-primary:hover { opacity: 0.9; }
        `}</style>
      </head>
      <body>
        <header class="app-header">
          <span class="app-badge">ET</span>
          <span class="app-title">Contact Intelligence</span>
          <nav class="app-nav">
            <button class="nav-btn" hx-get="/" hx-target="#canvas" hx-swap="innerHTML">Dashboard</button>
            <button class="nav-btn" hx-get="/companies" hx-target="#canvas" hx-swap="innerHTML">Companies</button>
            <button class="nav-btn" hx-get="/contacts" hx-target="#canvas" hx-swap="innerHTML">Contacts</button>
            <button class="nav-btn" hx-get="/analytics/articles" hx-target="#canvas" hx-swap="innerHTML">Articles</button>
            <button class="nav-btn" hx-get="/analytics/surveys" hx-target="#canvas" hx-swap="innerHTML">Surveys</button>
            <button class="nav-btn" hx-get="/messages" hx-target="#canvas" hx-swap="innerHTML">Messages</button>
          </nav>
        </header>
        <div class="app-body">
          <div class="chat-panel">
            <div class="chat-messages" id="chat-messages">
              <div class="chat-msg assistant">
                Welcome. Type <span class="font-mono" style="color: var(--visma-turquoise)">/</span> to see available commands.
              </div>
            </div>
            <div class="chat-input-area" x-data={`{
              open: false,
              idx: 0,
              value: '',
              commands: [
                { cmd: '/dashboard', desc: 'Overview with stats' },
                { cmd: '/companies', desc: 'List all companies' },
                { cmd: '/company ', desc: 'Show company profile', hasArg: true },
                { cmd: '/contacts', desc: 'List all contacts' },
                { cmd: '/contact ', desc: 'Show contact profile', hasArg: true },
                { cmd: '/articles', desc: 'Top articles by reader count' },
                { cmd: '/views', desc: 'Top pages by view count' },
                { cmd: '/surveys', desc: 'Survey completions and scores' },
                { cmd: '/engagement', desc: 'Company engagement rankings' },
                { cmd: '/lists', desc: 'View all lists and segments' },
                { cmd: '/list ', desc: 'Show a specific list', hasArg: true },
                { cmd: '/sync', desc: 'Show sync status' },
                { cmd: '/enrich', desc: 'Enrich contacts via Discovery Engine' },
                { cmd: '/research ', desc: 'Deep research a company via Gemini', hasArg: true },
                { cmd: '/help', desc: 'Show available commands' }
              ],
              get filtered() {
                if (!this.value.startsWith('/')) return [];
                const q = this.value.toLowerCase();
                return this.commands.filter(c => c.cmd.startsWith(q));
              },
              onInput(e) {
                this.value = e.target.value;
                this.open = this.value.startsWith('/') && this.filtered.length > 0;
                this.idx = 0;
              },
              onKeydown(e) {
                if (!this.open) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); this.idx = Math.min(this.idx + 1, this.filtered.length - 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); this.idx = Math.max(this.idx - 1, 0); }
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  const picked = this.filtered[this.idx];
                  if (!picked) return;
                  this.value = picked.cmd;
                  this.$refs.input.value = picked.cmd;
                  this.open = false;
                  if (!picked.hasArg) { this.$nextTick(() => this.$refs.form.requestSubmit()); }
                  else { this.$refs.input.focus(); }
                }
                else if (e.key === 'Tab') {
                  e.preventDefault();
                  const picked = this.filtered[this.idx];
                  if (!picked) return;
                  this.value = picked.cmd;
                  this.$refs.input.value = picked.cmd;
                  if (picked.hasArg) { this.open = false; }
                  else { this.open = false; this.$nextTick(() => this.$refs.form.requestSubmit()); }
                }
                else if (e.key === 'Escape') { this.open = false; }
              },
              pick(i) {
                const picked = this.filtered[i];
                if (!picked) return;
                this.value = picked.cmd;
                this.$refs.input.value = picked.cmd;
                this.open = false;
                if (!picked.hasArg) { this.$nextTick(() => this.$refs.form.requestSubmit()); }
                else { this.$refs.input.focus(); }
              }
            }`}>
              <div class="slash-dropdown" x-show="open" x-cloak>
                <template x-for="(c, i) in filtered" x-bind:key="c.cmd">
                  <div class="slash-option" x-bind:class="{ 'slash-option-active': i === idx }" x-on:click="pick(i)">
                    <span class="slash-cmd" x-text="c.cmd"></span>
                    <span class="slash-desc" x-text="c.desc"></span>
                  </div>
                </template>
              </div>
              <form class="chat-form" x-ref="form" hx-post="/chat" hx-target="#canvas" hx-swap="innerHTML" hx-on--after-request={`
                const input = this.querySelector('input');
                const msgs = document.getElementById('chat-messages');
                const userMsg = document.createElement('div');
                userMsg.className = 'chat-msg user';
                userMsg.textContent = input.value;
                msgs.appendChild(userMsg);
                input.value = '';
                const el = this.closest('[x-data]');
                Alpine.$data(el).value = '';
                Alpine.$data(el).open = false;
                msgs.scrollTop = msgs.scrollHeight;
              `}>
                <input
                  type="text"
                  name="message"
                  class="chat-input"
                  placeholder="Type / for commands..."
                  autocomplete="off"
                  x-ref="input"
                  x-on:input="onInput($event)"
                  x-on:keydown="onKeydown($event)"
                />
                <button type="submit" class="chat-submit">Send</button>
              </form>
            </div>
          </div>
          <div class="canvas-panel" id="canvas">
            {children}
          </div>
        </div>
        <script src="/static/htmx.min.js"></script>
        <script src="/static/alpine.min.js" defer></script>
      </body>
    </html>
  );
}
