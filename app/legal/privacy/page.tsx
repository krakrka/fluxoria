export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">Confidentialité</h1>
      <p>
        Les comptes, documents, factures et journaux sont rattachés à une organisation. L&apos;export et la suppression du compte sont proposés dans Paramètres.
        Le journal d&apos;audit nécessaire au suivi des actions n&apos;est pas détruit en même temps que les pièces.
      </p>
      <p>
        Les mesures produit enregistrent le nom de l&apos;événement, l&apos;organisation et l&apos;utilisateur. Elles ne copient ni le contenu d&apos;une facture, ni un mot de passe, ni un numéro de carte.
      </p>
      <p>
        La session dure 12 heures. Le cookie est celui de la session Auth.js. Il est marqué sécurisé lorsque l&apos;application tourne en production.
        Aucun traceur marketing n&apos;est déposé par le code actuel.
      </p>
      <h2 className="text-xl font-semibold">Informations encore absentes</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Identité du responsable de traitement, contact et délégué à la protection des données : non renseignés.</li>
        <li>Bases légales et durées de conservation autres que les réglages de l&apos;organisation : non renseignées.</li>
        <li>Liste réelle des sous-traitants et des transferts hors de l&apos;Union européenne : non renseignée.</li>
        <li>Modalités précises d&apos;accès, de rectification, d&apos;opposition, d&apos;effacement et de réclamation : à faire valider. L&apos;export et la suppression de compte existent dans le produit, sans se substituer à cette revue.</li>
      </ul>
    </>
  );
}
