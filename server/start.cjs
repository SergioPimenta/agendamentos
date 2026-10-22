// Ponto de entrada para hospedagens que carregam o arquivo com `require()` (ex.: Hostinger, via LiteSpeed lsnode.js).
// O servidor é ESM com `await` no topo (start.js), que o `require()` não aceita; aqui ele é carregado por `import()`.
// Em desenvolvimento e com `npm start`, o arquivo usado continua sendo o start.js.
import('./start.js').catch((err) => {
  console.error('[api] falha ao iniciar:', err);
  process.exit(1);
});
