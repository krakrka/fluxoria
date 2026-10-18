export default function CookiesPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">Cookies</h1>
      <p>
        Le cookie de session Auth.js maintient la connexion pendant 12 heures. Il est marqué sécurisé lorsque l&apos;application tourne en production.
        Aucun bandeau marketing n&apos;est actif : le code ne dépose pas de traceur publicitaire.
      </p>
      <h2 className="text-xl font-semibold">Informations encore absentes</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Nom exact publié du cookie et éditeur : à confirmer au déploiement.</li>
        <li>Tout traceur supplémentaire : interdit tant qu&apos;il n&apos;est pas décrit ici et, s&apos;il n&apos;est pas nécessaire au service, tant que le consentement n&apos;est pas recueilli.</li>
      </ul>
    </>
  );
}
