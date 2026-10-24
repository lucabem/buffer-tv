import { formatClock, formatQualityLabel, truncate } from "../core/format.js";
import { recommendIndex } from "../core/recommend.js";
import type { ChannelVariant, ProgrammeEntry, ServerConfig, StreamQuality } from "../core/types.js";
import { h } from "./dom.js";

/**
 * Diálogos nativos <dialog> con el mismo estilo. Cada uno se monta, se
 * muestra modal y se elimina del DOM al cerrarse.
 */
export interface SheetHandle {
  close(): void;
  element: HTMLDialogElement;
}

export function openSheet(build: (close: () => void) => HTMLElement, onClose?: () => void): SheetHandle {
  const dialog = h("dialog", { class: "sheet" });
  const close = () => dialog.close();
  dialog.append(build(close));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { close, element: dialog };
}

export function promptDialog(title: string, label: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    let value: string | null = null;
    openSheet(
      (close) => {
        const input = h("input", { placeholder, autocomplete: "off", spellcheck: "false" });
        const submit = () => {
          value = input.value.trim() || null;
          close();
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
        });
        queueMicrotask(() => input.focus());
        return h("div", { class: "sheet-body" },
          h("div", { class: "sheet-head" }, h("h2", { text: title })),
          h("label", { class: "field" }, h("span", { text: label }), input),
          h("div", { class: "sheet-foot" },
            h("button", { class: "btn btn-ghost", onclick: close, text: "Cancelar" }),
            h("button", { class: "btn btn-primary", onclick: submit, text: "Aceptar" }),
          ),
        );
      },
      () => resolve(value),
    );
  });
}

export interface ServerFormResult {
  server: ServerConfig;
  skipCheck: boolean;
}

/**
 * Alta/edición de servidor. `check` valida el servidor antes de guardar y
 * devuelve un error legible si falla.
 */
export function serverDialog(
  opts: {
    title: string;
    server?: ServerConfig;
    defaults: { delay_seconds: number; buffer_mb: number };
    check: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  },
  onSave: (server: ServerConfig) => void,
): void {
  const source = opts.server;
  const fields = {
    name: h("input", { value: source?.name ?? "", placeholder: "Ej. Casa", autocomplete: "off" }),
    url: h("input", { value: source?.url ?? "", placeholder: "http://servidor/…/gets.php?user=…&pass=…", autocomplete: "off", spellcheck: "false" }),
    delay: h("input", { value: String(source?.delay_seconds ?? opts.defaults.delay_seconds), inputmode: "numeric" }),
    buffer: h("input", { value: String(source?.buffer_mb ?? opts.defaults.buffer_mb), inputmode: "numeric" }),
  };
  const skip = h("input", { type: "checkbox" });
  const error = h("p", { class: "form-error", role: "alert" });
  let saveButton: HTMLButtonElement | null = null;

  openSheet((close) => {
    const setBusy = (busy: boolean) => {
      if (saveButton) saveButton.disabled = busy;
    };

    const commit = (server: ServerConfig) => {
      onSave(server);
      close();
    };

    const submit = async () => {
      const name = fields.name.value.trim();
      const url = fields.url.value.trim();
      if (!name || !url) {
        error.className = "form-error";
        error.textContent = "Nombre y URL son obligatorios";
        return;
      }
      const delay = Number.parseInt(fields.delay.value.trim(), 10);
      const buffer = Number.parseInt(fields.buffer.value.trim(), 10);
      if (Number.isNaN(delay) || Number.isNaN(buffer)) {
        error.className = "form-error";
        error.textContent = "Retraso y buffer deben ser números";
        return;
      }

      const server: ServerConfig = { name, url, delay_seconds: delay, buffer_mb: buffer, enabled: true };
      if (skip.checked) {
        commit(server);
        return;
      }

      setBusy(true);
      error.className = "form-error is-info";
      error.textContent = "Comprobando servidor…";
      const result = await opts.check(url);
      if (result.ok) {
        commit(server);
        return;
      }
      setBusy(false);
      error.className = "form-error";
      error.textContent = result.error;
    };

    saveButton = h("button", { class: "btn btn-primary", onclick: submit, text: "Guardar" }) as HTMLButtonElement;

    queueMicrotask(() => fields.name.focus());
    return h("div", { class: "sheet-body" },
      h("div", { class: "sheet-head" }, h("p", { class: "eyebrow", text: "Servidor IPTV" }), h("h2", { text: opts.title })),
      h("div", { class: "form-grid" },
        h("label", { class: "field span-2" }, h("span", { text: "Nombre" }), fields.name),
        h("label", { class: "field span-2" }, h("span", { text: "URL IPTV completa" }), fields.url),
        h("label", { class: "field" }, h("span", { text: "Retraso (segundos)" }), fields.delay),
        h("label", { class: "field" }, h("span", { text: "Buffer (MB)" }), fields.buffer),
      ),
      h("label", { class: "check" }, skip, "Guardar sin comprobar el servidor"),
      error,
      h("div", { class: "sheet-foot" },
        h("button", { class: "btn btn-ghost", onclick: close, text: "Cancelar" }),
        saveButton,
      ),
    );
  });
}

/**
 * Selector de calidad: sondea cada variante y recomienda la de mejor
 * resolución real medida. La lista conserva su orden; la recomendada se marca.
 */
export function qualityDialog(
  baseName: string,
  variants: ChannelVariant[],
  probe: (url: string) => Promise<StreamQuality>,
  onPick: (variant: ChannelVariant) => void,
): void {
  let closed = false;
  let sheet: SheetHandle | undefined;
  const hint = h("p", { class: "variant-hint", text: "Comprobando calidad real…" });

  const entries = variants.map((variant) => {
    const sub = h("small", { text: "comprobando calidad real" });
    const button = h("button", {
      class: "variant is-probing",
      onclick: () => {
        closed = true;
        sheet?.close();
        onPick(variant);
      },
    }, h("span", { text: truncate(variant.label, 40) }), sub) as HTMLButtonElement;
    const result = probe(variant.url).catch((): StreamQuality => ({ width: null, height: null, codec: null, fps: null }));
    return { variant, button, sub, result };
  });

  for (const entry of entries) {
    void entry.result.then((quality) => {
      if (closed) return;
      entry.button.classList.remove("is-probing");
      entry.sub.textContent = formatQualityLabel(quality) ?? entry.variant.label;
    });
  }

  void Promise.all(entries.map((entry) => entry.result)).then((qualities) => {
    if (closed) return;
    const best = recommendIndex(qualities);
    if (best === null) {
      hint.textContent = "No se pudo medir la calidad de ninguna variante";
      return;
    }
    const recommended = entries[best];
    recommended.button.classList.add("is-recommended");
    hint.textContent = `Recomendada: ${recommended.variant.label} · ${formatQualityLabel(qualities[best]) ?? ""}`;
  });

  sheet = openSheet(
    (close) =>
      h("div", { class: "sheet-body" },
        h("div", { class: "sheet-head" }, h("p", { class: "eyebrow", text: "Calidades disponibles" }), h("h2", { text: baseName })),
        hint,
        h("div", { class: "variant-list sheet-scroll" }, ...entries.map((entry) => entry.button)),
        h("div", { class: "sheet-foot" }, h("button", { class: "btn btn-ghost", onclick: () => { closed = true; close(); }, text: "Cancelar" })),
      ),
    () => {
      closed = true;
    },
  );
}

export function loadingDialog(title: string, message: string): () => void {
  const handle = openSheet((): HTMLElement =>
    h("div", { class: "sheet-body" },
      h("div", { class: "loading" }, h("div", { class: "spinner" }), h("div", {},
        h("strong", { text: title, style: "display:block;font-weight:600" }),
        h("span", { class: "muted", text: message, style: "font-size:12px" }),
      )),
    ),
  );
  return () => handle.close();
}

export function epgDialog(channelName: string, notFound: boolean, programmes: ProgrammeEntry[]): void {
  const now = Date.now() / 1000;
  const body =
    notFound || programmes.length === 0
      ? h("p", { class: "empty", style: "padding:28px 8px" },
          h("strong", { text: "Sin programación disponible" }),
          h("span", { text: notFound ? "Este canal no aparece en la guía EPG_dobleM." : "No hay programas listados para hoy." }),
        )
      : h("div", { class: "epg-list sheet-scroll", style: "max-height:56vh" },
          ...programmes.map((programme) => {
            const isLive = programme.stop !== null && programme.start <= now && now < programme.stop;
            const isPast = programme.stop !== null && programme.stop <= now;
            return h("div", { class: `epg-row${isLive ? " is-live" : ""}${isPast ? " is-past" : ""}` },
              h("time", {}, `${formatClock(programme.start)}–${formatClock(programme.stop)}`),
              h("div", {},
                h("strong", {}, programme.title || "(sin título)", isLive ? h("span", { class: "epg-live", text: "En directo" }) : null),
                programme.desc ? h("p", { text: truncate(programme.desc, 180) }) : null,
              ),
            );
          }),
        );

  openSheet((close) =>
    h("div", { class: "sheet-body" },
      h("div", { class: "sheet-head" }, h("p", { class: "eyebrow", text: "Programación de hoy" }), h("h2", { text: channelName })),
      body,
      h("div", { class: "sheet-foot" }, h("button", { class: "btn btn-ghost", onclick: close, text: "Cerrar" })),
    ),
  );
}

