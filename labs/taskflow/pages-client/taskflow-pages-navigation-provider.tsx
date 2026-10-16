"use client";

/**
 * Browser adapter for the existing Multica @multica/views NavigationProvider.
 * The original TaskFlow shared views can keep using useNavigation()/AppLink,
 * while the host address stays on GitHub Pages. This is a source-only bridge;
 * the full native Dashboard composition is still under development.
 */
import {useEffect,useMemo,useState,useSyncExternalStore,type ReactNode} from "react";
import {NavigationProvider,type NavigationAdapter} from "@multica/views/navigation";
import {createPagesRouteController} from "./taskflow-pages-navigation.mjs";

export function TaskFlowPagesNavigationProvider({children}:{children:ReactNode}){
  // Pages runtime mounts client-side only; never use Next.js server navigation
  // or try to replace the browser origin with Render.
  const [controller]=useState(()=>createPagesRouteController(window));
  const route=useSyncExternalStore(
    controller.subscribe,controller.snapshot,
    ()=>({state:"home" as const,path:"/"})
  );
  useEffect(()=>()=>controller.dispose(),[controller]);
  const adapter=useMemo<NavigationAdapter>(()=>{
    const fallback=route.path||"/";
    const url=new URL(fallback,"https://native-taskflow.invalid");
    return {
      pathname:url.pathname,
      searchParams:url.searchParams,
      hash:url.hash,
      push:controller.push,
      replace:controller.replace,
      back:controller.back,
      getShareableUrl:controller.getShareableUrl,
      openInNewTab:controller.openInNewTab,
      canGoBack:()=>window.history.length>1,
    };
  },[route,controller]);
  return <NavigationProvider value={adapter}>{children}</NavigationProvider>;
}
