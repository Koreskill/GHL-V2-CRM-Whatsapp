"use client";

import { Bot, User } from "lucide-react";

/**
 * Burbuja temporal de "escribiendo…". NO es un mensaje: no se guarda ni entra al historial.
 * Se ve solo dentro del CRM: Zernio no expone typing/presence, así que la persona del otro lado
 * (WhatsApp, Instagram, Messenger) no ve nada de esto.
 */
export function TypingBubble({ who }: { who: "agent" | "human" }) {
  const agent = who === "agent";
  const Icon = agent ? Bot : User;
  return (
    <div className="flex justify-end" aria-live="polite">
      <div className="flex max-w-[72%] items-center gap-2 rounded-2xl rounded-br-md border border-line bg-card px-3.5 py-2">
        <Icon className="size-3.5 shrink-0 text-muted" strokeWidth={1.8} />
        <span className="text-[12.5px] text-muted">
          {agent ? "El agente está escribiendo" : "Un miembro del equipo está escribiendo"}
        </span>
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-bounce rounded-full bg-muted/60"
              // Desfasados para que se lea como tres puntos que rebotan, no como uno solo.
              style={{ animationDelay: `${i * 150}ms`, animationDuration: "1s" }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
