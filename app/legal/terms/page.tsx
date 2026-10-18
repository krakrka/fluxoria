export default function TermsPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">Conditions d&apos;utilisation</h1>
      <p>
        Fluxora est un outil de traitement administratif. Les comptes, documents et factures appartiennent à l&apos;organisation qui les dépose.
        L&apos;essai, les plafonds et les prix affichés sont ceux configurés dans l&apos;application au moment de la souscription.
      </p>
      <p>Un paiement n&apos;est reçu que lorsque le prestataire de paiement le confirme au serveur. Le retour du navigateur ne vaut pas preuve.</p>
      <h2 className="text-xl font-semibold">Informations encore absentes</h2>
      <p>Le responsable de Fluxora doit renseigner ces éléments avant toute utilisation commerciale. Ils ne sont pas inventés ici.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Raison sociale, forme juridique, capital, adresse, RCS et numéro de TVA : non renseignés.</li>
        <li>Durée du contrat, reconduction, résiliation et préavis : non renseignés.</li>
        <li>Plafond de responsabilité et exclusions : non renseignés.</li>
        <li>Droit applicable et tribunal compétent : non renseignés.</li>
      </ul>
    </>
  );
}
