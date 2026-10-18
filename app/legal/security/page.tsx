export default function SecurityPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">Sécurité</h1>
      <p>
        Les organisations sont isolées côté serveur. Les mots de passe sont stockés sous forme d&apos;empreinte. Les pages envoient des en-têtes de sécurité et une politique de contenu.
        Cette page décrit des mesures techniques. Elle n&apos;est pas une certification, un audit ou un engagement de conformité.
      </p>
      <p>
        Un signalement de faille se fait auprès du contact que le responsable de Fluxora publiera. En attendant, aucun délai de réponse n&apos;est promis.
      </p>
      <h2 className="text-xl font-semibold">Informations encore absentes</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Contact de signalement et délai de réponse : non renseignés.</li>
        <li>Sous-traitants réellement utilisés et pays d&apos;hébergement : non renseignés.</li>
        <li>Aucune certification n&apos;est détenue au titre de cette page.</li>
      </ul>
    </>
  );
}
