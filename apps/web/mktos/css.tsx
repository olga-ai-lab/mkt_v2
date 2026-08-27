"use client";
// @ts-nocheck
import { createElement, useState, type CSSProperties } from "react";

/** Converte uma string CSS inline (do protótipo) em objeto de estilo React. */
export function css(input?: string | null): CSSProperties {
  const out: any = {};
  if (!input) return out;
  for (const decl of String(input).split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    const key = prop.startsWith("--")
      ? prop
      : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = value;
  }
  return out;
}

/** Elemento com estilo de hover (equivalente ao `style-hover` do protótipo). */
export function HoverEl({ as = "div", style, hoverStyle, children, ...rest }: any) {
  const [hover, setHover] = useState(false);
  return createElement(
    as,
    {
      ...rest,
      style: hover ? { ...style, ...hoverStyle } : style,
      onMouseEnter: (e: any) => {
        setHover(true);
        rest.onMouseEnter?.(e);
      },
      onMouseLeave: (e: any) => {
        setHover(false);
        rest.onMouseLeave?.(e);
      },
    },
    children,
  );
}
