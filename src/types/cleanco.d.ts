declare module 'cleanco' {
  function cleanco(companyName: string): {
    clean_name(): string;
  };
  export = cleanco;
}
