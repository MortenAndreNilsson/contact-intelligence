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

          .app-status {
            margin-left: auto;
            font-family: var(--font-mono);
            font-size: 0.7rem;
            color: var(--color-text-muted);
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

          a { color: var(--color-accent); text-decoration: none; }
          a:hover { color: var(--color-accent-hover); }

          /* Scrollbar */
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: var(--color-surface-hover); border-radius: 3px; }
        `}</style>
      </head>
      <body>
        <header class="app-header">
          <span class="app-badge">ET</span>
          <span class="app-title">Contact Intelligence</span>
          <span class="app-status">Local</span>
        </header>
        <div class="app-body">
          <div class="chat-panel">
            <div class="chat-messages" id="chat-messages">
              <div class="chat-msg assistant">
                Welcome. Ask me about companies, contacts, or type "dashboard" to see an overview.
              </div>
            </div>
            <div class="chat-input-area">
              <form class="chat-form" hx-post="/chat" hx-target="#canvas" hx-swap="innerHTML" hx-on--after-request="
                const input = this.querySelector('input');
                const msgs = document.getElementById('chat-messages');
                const userMsg = document.createElement('div');
                userMsg.className = 'chat-msg user';
                userMsg.textContent = input.value;
                msgs.appendChild(userMsg);
                input.value = '';
                msgs.scrollTop = msgs.scrollHeight;
              ">
                <input
                  type="text"
                  name="message"
                  class="chat-input"
                  placeholder="Ask something..."
                  autocomplete="off"
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
