01:58:13.642 Running build in Washington, D.C., USA (East) – iad1
01:58:13.643 Build machine configuration: 2 cores, 8 GB
01:58:14.132 Cloning github.com/titxs/The-Trading-Journal- (Branch: main, Commit: 19d3c45)
01:58:14.506 Cloning completed: 374.000ms
01:58:14.758 Restored build cache from previous deployment (GZgKR2ad8Pn3j7ekt7SZsmp9r7Y8)
01:58:15.386 Running "vercel build"
01:58:15.408 Vercel CLI 53.3.2
01:58:15.902 Installing dependencies...
01:58:19.196 
01:58:19.197 up to date in 3s
01:58:19.197 
01:58:19.198 10 packages are looking for funding
01:58:19.198   run `npm fund` for details
01:58:19.239 Running "npm run build"
01:58:19.340 
01:58:19.340 > trade-journal@2.0.0 build
01:58:19.340 > vite build
01:58:19.340 
01:58:19.579 vite v5.4.21 building for production...
01:58:19.633 transforming...
01:58:19.730 ✓ 6 modules transformed.
01:58:19.732 x Build failed in 129ms
01:58:19.733 error during build:
01:58:19.734 [vite:esbuild] Transform failed with 2 errors:
01:58:19.734 /vercel/path0/src/TradeJournal.jsx:765:6: ERROR: The symbol "NavIcon" has already been declared
01:58:19.734 /vercel/path0/src/TradeJournal.jsx:1338:5: ERROR: Expected ";" but found ":"
01:58:19.735 file: /vercel/path0/src/TradeJournal.jsx:765:6
01:58:19.735 
01:58:19.735 The symbol "NavIcon" has already been declared
01:58:19.736 763|  
01:58:19.736 764|  // ── nav icons ─────────────────────────────────────────────────────────────────
01:58:19.736 765|  const NavIcon = {
01:58:19.736    |        ^
01:58:19.737 766|    home: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>,
01:58:19.737 767|    quick: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>,
01:58:19.737 
01:58:19.738 Expected ";" but found ":"
01:58:19.738 1336|  }
01:58:19.738 1337|    history: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
01:58:19.739 1338|    log: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
01:58:19.739    |       ^
01:58:19.739 1339|    stats: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
01:58:19.740 1340|  };
01:58:19.740 
01:58:19.740     at failureErrorWithLog (/vercel/path0/node_modules/esbuild/lib/main.js:1472:15)
01:58:19.741     at /vercel/path0/node_modules/esbuild/lib/main.js:755:50
01:58:19.741     at responseCallbacks.<computed> (/vercel/path0/node_modules/esbuild/lib/main.js:622:9)
01:58:19.741     at handleIncomingPacket (/vercel/path0/node_modules/esbuild/lib/main.js:677:12)
01:58:19.742     at Socket.readFromStdout (/vercel/path0/node_modules/esbuild/lib/main.js:600:7)
01:58:19.742     at Socket.emit (node:events:509:28)
01:58:19.742     at addChunk (node:internal/streams/readable:563:12)
01:58:19.742     at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)
01:58:19.743     at Readable.push (node:internal/streams/readable:394:5)
01:58:19.743     at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
01:58:19.764 Error: Command "npm run build" exited with 1
