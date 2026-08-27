"use client";
// @ts-nocheck
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Component } from "./logic";

const Ctx = createContext<any>(null);

export function MktosProvider({ children, props = {} }: { children: ReactNode; props?: any }) {
  const [, force] = useState(0);
  const ref = useRef<any>(null);
  if (!ref.current) {
    const c = new Component();
    c.props = props;
    c._emit = () => force((n) => n + 1);
    ref.current = c;
  }
  const vals = ref.current.renderVals();
  const value = useMemo(() => vals, [vals]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Todos os dados/ações da tela, exatamente como o protótipo original expõe. */
export function useMktos(): any {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMktos precisa estar dentro de <MktosProvider>");
  return v;
}
