async function main() {
  // @ts-expect-error embedded-postgres 的 exports 映射需要 nodenext 解析，运行时可用
  const mod: any = await import('embedded-postgres');
  const EmbeddedPostgres = mod.EmbeddedPostgres || mod.default;

  const pg = new EmbeddedPostgres({
    databaseDir: './.pgdata2',
    user: 'teamspace',
    password: 'teamspace_dev_pwd',
    port: 5434,
    postgresFlags: ['-h', '127.0.0.1', '-c', 'listen_addresses=127.0.0.1'],
  });

  await pg.initialise();
  await pg.start();

  console.log('Postgres started on 127.0.0.1:5433 (user: teamspace, db: teamspace)');
  console.log('Press Ctrl+C to stop');

  process.on('SIGINT', async () => {
    await pg.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
