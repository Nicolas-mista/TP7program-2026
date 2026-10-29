"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Torre" },
  { href: "/analitica", label: "Analitica" },
  { href: "/demo", label: "Demo" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");

  const activo = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">RS</span>
          <span>
            RutaSur
            <small>torre de control</small>
          </span>
        </Link>

        <nav className="nav">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={activo(l.href) ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="topbar-right">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const id = busqueda.trim().toUpperCase();
              if (id) router.push(`/envios/${encodeURIComponent(id)}`);
            }}
            className="row"
            style={{ gap: 6 }}
          >
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="SHP-000001"
              aria-label="Buscar envio"
              style={{
                background: "var(--bg-soft)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "6px 9px",
                fontSize: 12,
                width: 130,
                outline: "none",
              }}
            />
            <button type="submit" className="btn btn-sm btn-ghost">
              Buscar
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
