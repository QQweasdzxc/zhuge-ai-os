import {build} from 'esbuild';
await build({entryPoints:[new URL('./realtime-entry.mjs',import.meta.url).pathname],outfile:new URL('../../ZG-ERP/erp-private-updates.js',import.meta.url).pathname,bundle:true,format:'iife',target:'es2020',minify:true});
