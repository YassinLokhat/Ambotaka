# Conception UML complète : système de gestion du trafic en temps réel

> **Version de travail consolidée**\
> Document de conception fonctionnelle et technique regroupant les
> éléments élaborés dans les échanges : exigences connues, acteurs, cas
> d'utilisation, classes, séquences, activités, états-transitions,
> composants et déploiement.
>
> **Important :** cette conception constitue une base structurée, mais
> pas encore une validation exhaustive des exigences RM-01 à RM-160 et
> RM-C01 à RM-C24. Les choix techniques non confirmés sont signalés
> comme propositions.

## Table des matières

1.  [Présentation et périmètre](#1-présentation-et-périmètre)
2.  [Principes métier et règles
    transversales](#2-principes-métier-et-règles-transversales)
3.  [Acteurs et cas d'utilisation](#3-acteurs-et-cas-dutilisation)
4.  [Modèle de classes](#4-modèle-de-classes)
5.  [Diagrammes de séquence](#5-diagrammes-de-séquence)
6.  [Diagrammes d'activité](#6-diagrammes-dactivité)
7.  [Diagrammes d'états-transitions](#7-diagrammes-détats-transitions)
8.  [Diagrammes de composants](#8-diagrammes-de-composants)
9.  [Diagrammes de déploiement](#9-diagrammes-de-déploiement)
10. [Architecture technique
    proposée](#10-architecture-technique-proposée)
11. [Points à valider et décisions
    ouvertes](#11-points-à-valider-et-décisions-ouvertes)

------------------------------------------------------------------------

# 1. Présentation et périmètre

## 1.1 Objectif du système

Le système a pour objectif d'aider les conducteurs à préparer et suivre
leurs déplacements, à consulter les conditions de circulation en temps
réel, à signaler et confirmer des incidents routiers et à recevoir des
recommandations d'itinéraires.

Le système comprend : - une application mobile destinée aux conducteurs
; - un backend exposant les API et les services métier ; - des
mécanismes de collecte, validation et agrégation des observations de
trafic ; - un mécanisme de signalement et de gestion des incidents ; -
un moteur de recommandation d'itinéraires ; - des fonctions de
confidentialité, consentement et suppression des données ; - une
interface d'administration et des mécanismes de supervision ; - des
intégrations avec des services externes, notamment cartographiques et de
notification.

## 1.2 Périmètre fonctionnel

  -----------------------------------------------------------------------
  Domaine                             Fonctionnalités principales
  ----------------------------------- -----------------------------------
  Navigation                          Recherche d'itinéraires, sélection,
                                      démarrage, suivi, interruption,
                                      restauration et fin de navigation

  Trafic                              Collecte facultative d'observations
                                      GPS, validation, association à un
                                      segment routier et agrégation

  Incidents                           Signalement, confirmation,
                                      contestation, validation et suivi
                                      du cycle de vie

  Recommandations                     Analyse du trafic et des incidents,
                                      calcul d'alternatives et
                                      proposition de changement
                                      d'itinéraire

  Confidentialité                     Gestion des consentements, retrait
                                      du consentement et demandes de
                                      suppression

  Synchronisation                     Fonctionnement hors ligne, file
                                      persistante, reprise et
                                      synchronisation

  Administration                      Authentification, rôles,
                                      permissions, configuration et audit

  Supervision                         Métriques, détection d'anomalies,
                                      incidents techniques et alertes
  -----------------------------------------------------------------------

## 1.3 Limites de cette version

Cette version reprend les éléments fonctionnels et techniques présents
dans les échanges. Elle ne prétend pas reconstituer mot pour mot tous
les libellés de RM-01 à RM-160, ni toutes les clarifications RM-C01 à
RM-C24. Les seuils de confiance, règles précises de rapprochement
d'incidents, durées de conservation autres que celles explicitement
établies et certains droits administratifs restent à vérifier dans le
référentiel complet des exigences.

------------------------------------------------------------------------

# 2. Principes métier et règles transversales

## 2.1 Navigation et sessions

1.  Une recherche d'itinéraire ne crée pas automatiquement une session
    de navigation.
2.  Une session est créée lorsque le conducteur démarre effectivement la
    navigation.
3.  Le statut métier de la session et son état opérationnel sont deux
    notions distinctes.
4.  Une session peut rester `EN_COURS` tout en étant techniquement
    `INTERROMPUE`.
5.  Une interruption technique ne constitue pas une annulation
    volontaire.
6.  La session peut être restaurée pendant une fenêtre maximale de 24
    heures à compter de la première interruption empêchant la navigation
    normale.
7.  Les interruptions supplémentaires ne réinitialisent pas le délai.
8.  Une récupération partielle ne réinitialise pas le délai si la
    navigation ne peut pas reprendre effectivement.
9.  La reprise effective est possible sans Internet si le GPS est fiable
    et si les données cartographiques locales sont suffisantes.
10. Si le GPS revient mais que les cartes locales sont insuffisantes et
    qu'Internet reste indisponible, la session demeure interrompue.
11. Aucune instruction de guidage ne doit être produite à partir d'une
    position obsolète ou non fiable.
12. La fermeture de l'application, son arrêt forcé et le redémarrage du
    téléphone ne doivent pas effacer l'état nécessaire à la
    restauration, dans la mesure permise par le système.
13. Le redémarrage du téléphone ne réinitialise pas le délai de 24
    heures.
14. Le temps monotone doit être utilisé lorsqu'il est disponible. Un
    horodatage civil persistant est également nécessaire pour traverser
    un redémarrage.
15. Si l'horloge a été modifiée et que le temps écoulé ne peut pas être
    déterminé de manière fiable, le système ne doit pas prolonger
    artificiellement la session. Une expiration conservatrice est
    appliquée.
16. L'expiration théorique correspond à
    `première_interruption + 24 heures`. L'heure de détection de
    l'expiration peut être conservée séparément à des fins techniques.
17. Une session expirée n'est plus restaurable. Le conducteur peut
    démarrer une nouvelle navigation.
18. Si plusieurs sessions expirent pendant que l'application est fermée,
    une notification groupée peut être présentée. Elle ne doit pas être
    répétée après acquittement.

## 2.2 Résumés de trajets

-   Un résumé de trajet expiré est conservé localement pendant 30 jours.
-   Il peut contenir les dates de début et de fin, la durée si elle est
    calculable, la distance si elle est disponible et le statut final
    `EXPIREE`.
-   Il ne contient ni itinéraire détaillé ni trace GPS brute.
-   La durée effective de navigation exclut les périodes d'interruption.
-   Si les données temporelles sont insuffisantes, la durée doit être
    déclarée indisponible plutôt que calculée arbitrairement.
-   La suppression d'un résumé supprime uniquement cette entrée
    d'historique. Elle ne supprime pas les journaux techniques, les
    agrégats statistiques, les autres trajets ou une session active.
-   Les catégories de données disposent de politiques de conservation
    distinctes.

## 2.3 GPS et consentements

-   L'autorisation d'utiliser le GPS pour la navigation est distincte du
    consentement à contribuer aux statistiques de trafic.
-   Le conducteur peut utiliser la navigation sans contribuer aux
    statistiques, sous réserve des permissions système nécessaires.
-   Les observations destinées aux statistiques ne sont collectées que
    si le consentement statistique est actif.
-   Le retrait du consentement statistique arrête les nouvelles
    contributions et déclenche le processus de suppression des
    observations brutes concernées, y compris les éléments en attente
    localement et les données côté serveur.
-   Les agrégats ne peuvent être conservés que s'ils ne permettent pas
    de réidentifier les contributeurs.

## 2.4 Signalements et incidents

-   Un signalement et un incident sont deux objets métier distincts.
-   Un signalement peut être associé à zéro ou un incident.
-   Plusieurs signalements peuvent contribuer au même incident.
-   Un incident peut également être détecté indépendamment d'un
    signalement utilisateur.
-   Un conducteur ne peut confirmer ou contester plusieurs fois le même
    incident.
-   La confiance d'un incident dépend des confirmations, contestations
    et de la qualité des éléments disponibles.
-   Les seuils de validation et les règles de rapprochement doivent être
    configurables et confirmés par les exigences.
-   La validation d'un signalement ne signifie pas automatiquement que
    l'incident est confirmé.

## 2.5 Suppression et synchronisation

-   Une demande de suppression possède un identifiant unique et une clé
    d'idempotence.
-   Elle est limitée aux données de l'installation concernée.
-   Une demande ne doit jamais supprimer des données appartenant à une
    autre installation.
-   Les tentatives sont répétées avec un backoff exponentiel, sans
    abandon automatique de la demande.
-   La demande reste persistante jusqu'à une confirmation explicite du
    serveur.
-   Une réponse répétée à une demande déjà traitée doit retourner un
    résultat cohérent.
-   Une donnée en attente de suppression ne doit pas être retransmise
    par la synchronisation ordinaire. Cette priorité est une règle
    d'architecture recommandée.
-   Les notifications relatives aux suppressions ne doivent contenir
    aucune coordonnée GPS.
-   Le conducteur est notifié après suppression réussie ou lorsqu'un
    problème persistant nécessite son attention.

------------------------------------------------------------------------

# 3. Acteurs et cas d'utilisation

## 3.1 Acteurs

  -----------------------------------------------------------------------
  Acteur                              Description
  ----------------------------------- -----------------------------------
  Conducteur                          Utilise les fonctions de
                                      navigation, trafic, signalement,
                                      recommandations et confidentialité

  Administrateur                      Administre et supervise le système
                                      selon ses permissions

  Service GPS                         Fournit les informations de
                                      localisation du terminal

  Fournisseur cartographique          Fournit cartes, géocodage et calcul
                                      d'itinéraires

  Service de notification             Transporte les notifications Push

  Fournisseur d'identité externe      Vérifie une identité si une
                                      authentification externe est
                                      retenue
  -----------------------------------------------------------------------

## 3.2 Diagramme global de cas d'utilisation

``` mermaid
flowchart LR
    DRIVER(["Conducteur"])
    ADMIN(["Administrateur"])
    GPS(["Service GPS"])
    MAP(["Fournisseur cartographique"])
    PUSH(["Service de notification"])
    IDP(["Fournisseur d'identité externe"])

    subgraph SYSTEM["Système de gestion du trafic en temps réel"]
        subgraph NAV["A. Navigation et trajets"]
            UC01(["Rechercher un itinéraire"])
            UC02(["Consulter les itinéraires proposés"])
            UC03(["Démarrer une navigation"])
            UC04(["Suivre un itinéraire en temps réel"])
            UC05(["Interrompre une session"])
            UC06(["Restaurer une session"])
            UC07(["Terminer une navigation"])
            UC08(["Consulter l'historique des trajets"])
            UC09(["Supprimer un résumé de trajet"])
            UC10(["Consulter un résumé de trajet"])
        end

        subgraph TRAFFIC["B. Trafic et collecte"]
            UC11(["Consulter l'état du trafic"])
            UC12(["Collecter les observations GPS"])
            UC13(["Valider les observations"])
            UC14(["Calculer les statistiques de trafic"])
        end

        subgraph INCIDENT["C. Signalements et incidents"]
            UC16(["Signaler un incident"])
            UC17(["Consulter les incidents"])
            UC18(["Confirmer un incident"])
            UC19(["Contester un incident"])
            UC20(["Traiter les signalements"])
            UC21(["Gérer le cycle de vie des incidents"])
        end

        subgraph RECO["D. Recommandations"]
            UC22(["Recevoir une recommandation"])
            UC23(["Consulter une alternative"])
            UC24(["Accepter une recommandation"])
            UC25(["Ignorer une recommandation"])
        end

        subgraph PRIVACY["E. Confidentialité et données"]
            UC26(["Gérer le consentement GPS"])
            UC27(["Gérer le consentement statistique"])
            UC28(["Retirer le consentement statistique"])
            UC29(["Demander la suppression des données"])
            UC30(["Synchroniser les demandes de suppression"])
            UC31(["Consulter les notifications de confidentialité"])
        end

        subgraph ADMINISTRATION["F. Administration et supervision"]
            UC32(["S'authentifier"])
            UC33(["Gérer les rôles et permissions"])
            UC34(["Gérer les paramètres système"])
            UC35(["Consulter les journaux d'audit"])
            UC36(["Superviser les services"])
            UC37(["Consulter les métriques système"])
            UC38(["Gérer les incidents techniques"])
            UC39(["Gérer les alertes techniques"])
        end

        UC40(["Synchroniser les données"])
        UC41(["Consulter les notifications"])
    end

    DRIVER --- UC01
    DRIVER --- UC02
    DRIVER --- UC03
    DRIVER --- UC04
    DRIVER --- UC05
    DRIVER --- UC06
    DRIVER --- UC07
    DRIVER --- UC08
    DRIVER --- UC09
    DRIVER --- UC10
    DRIVER --- UC11
    DRIVER --- UC16
    DRIVER --- UC17
    DRIVER --- UC18
    DRIVER --- UC19
    DRIVER --- UC22
    DRIVER --- UC23
    DRIVER --- UC24
    DRIVER --- UC25
    DRIVER --- UC26
    DRIVER --- UC27
    DRIVER --- UC28
    DRIVER --- UC29
    DRIVER --- UC31
    DRIVER --- UC40
    DRIVER --- UC41

    ADMIN --- UC32
    ADMIN --- UC33
    ADMIN --- UC34
    ADMIN --- UC35
    ADMIN --- UC36
    ADMIN --- UC37
    ADMIN --- UC38
    ADMIN --- UC39

    GPS --- UC12
    GPS --- UC04
    MAP --- UC01
    MAP --- UC02
    PUSH --- UC41
    PUSH --- UC31
    IDP --- UC32

    UC03 -.->|include| UC01
    UC04 -.->|include| UC12
    UC12 -.->|include| UC13
    UC24 -.->|extend| UC22
    UC25 -.->|extend| UC22
    UC28 -.->|include| UC29
    UC36 -.->|include| UC37
    UC33 -.->|include| UC32
    UC34 -.->|include| UC32
    UC35 -.->|include| UC32
    UC38 -.->|include| UC39
```

> Le diagramme est une vue globale. Les relations `include` et `extend`
> devront être affinées avec les descriptions détaillées des exigences.
> Par exemple, la recherche d'un itinéraire peut être un cas
> d'utilisation préalable au démarrage sans être nécessairement incluse
> à chaque démarrage si un itinéraire déjà calculé est sélectionné.

## 3.3 Cas d'utilisation détaillés à décomposer

1.  Navigation et gestion des trajets.
2.  Trafic et collecte des données GPS.
3.  Signalements et gestion des incidents.
4.  Recommandations d'itinéraires.
5.  Confidentialité, consentements et suppressions.
6.  Administration et supervision.

------------------------------------------------------------------------

# 4. Modèle de classes

## 4.1 Conventions

  Élément      Convention
  ------------ ---------------------
  `UUID`       Identifiant unique
  `String`     Texte
  `Boolean`    Valeur booléenne
  `Integer`    Entier
  `Long`       Entier long
  `Double`     Nombre décimal
  `DateTime`   Date et heure
  `Duration`   Durée
  `Enum`       Énumération
  `JSON`       Données structurées

Les diagrammes ci-dessous sont des modèles conceptuels/logiques de
première version. Les méthodes indiquent les responsabilités principales
et ne constituent pas encore une spécification d'API.

## 4.2 Sous-domaine : navigation et itinéraires

``` mermaid
classDiagram
    class Conducteur {
        +UUID id
        +String identifiant
        +DateTime dateCreation
        +consulterHistorique()
        +donnerConsentementGPS()
        +retirerConsentementGPS()
        +donnerConsentementStatistique()
        +retirerConsentementStatistique()
    }

    class RechercheItineraire {
        +UUID id
        +DateTime dateCreation
        +StatutRecherche statut
        +String preference
        +demarrer()
        +ajouterResultats()
        +terminer()
        +signalerEchec()
    }

    class Lieu {
        +UUID id
        +String nom
        +String adresse
        +Double latitude
        +Double longitude
        +String identifiantExterne
    }

    class Itineraire {
        +UUID id
        +String identifiantFournisseur
        +Double distance
        +Duration dureeReference
        +Duration dureeEstimee
        +Double confiance
        +SourceEstimation sourceEstimation
    }

    class SessionNavigation {
        +UUID id
        +DateTime dateDebut
        +DateTime dateFin
        +StatutSession statut
        +EtatOperationnel etatOperationnel
        +DateTime premiereInterruption
        +DateTime expirationTheorique
        +Duration dureeEffective
        +Double distanceParcourue
        +demarrer()
        +interrompre()
        +reprendre()
        +terminer()
        +annuler()
        +expirer()
        +restaurer()
        +calculerDureeEffective()
    }

    class MotifInterruption {
        +UUID id
        +CauseInterruption cause
        +DateTime dateDebut
        +DateTime dateFin
        +enregistrer()
        +cloturer()
    }

    class ResumeTrajet {
        +UUID id
        +DateTime dateDebut
        +DateTime dateFin
        +Duration dureeEffective
        +Double distance
        +StatutSession statutFinal
        +DateTime dateExpiration
        +supprimer()
        +estExpire()
    }

    class StatutRecherche {
        <<enumeration>>
        EN_COURS
        TERMINEE
        ECHEC
    }

    class StatutSession {
        <<enumeration>>
        EN_COURS
        TERMINEE
        ANNULEE
        EXPIREE
    }

    class EtatOperationnel {
        <<enumeration>>
        ACTIVE
        INTERROMPUE
        RESTAURATION_EN_ATTENTE
    }

    class CauseInterruption {
        <<enumeration>>
        GPS_INDISPONIBLE
        RESEAU_INDISPONIBLE
        DONNEES_CARTOGRAPHIQUES_INDISPONIBLES
        APPLICATION_FERMEE
        SYSTEME_INDISPONIBLE
    }

    class SourceEstimation {
        <<enumeration>>
        TRAFIC_RECENT
        PROFIL_HISTORIQUE
        DUREE_REFERENCE
        INDISPONIBLE
    }

    Conducteur "1" --> "0..*" RechercheItineraire
    Conducteur "1" --> "0..*" SessionNavigation
    RechercheItineraire "1" --> "1" Lieu : origine
    RechercheItineraire "1" --> "1" Lieu : destination
    RechercheItineraire "1" --> "0..*" Itineraire : résultats
    SessionNavigation "1" --> "1" Itineraire : itinéraire suivi
    SessionNavigation "0..*" --> "0..1" RechercheItineraire : recherche source
    SessionNavigation "1" *-- "0..*" MotifInterruption
    SessionNavigation "1" *-- "0..1" ResumeTrajet
```

### Énumérations et contraintes

-   `StatutRecherche` : `EN_COURS`, `TERMINEE`, `ECHEC`.
-   `StatutSession` : `EN_COURS`, `TERMINEE`, `ANNULEE`, `EXPIREE`.
-   `EtatOperationnel` : `ACTIVE`, `INTERROMPUE`,
    `RESTAURATION_EN_ATTENTE`.
-   `CauseInterruption` : `GPS_INDISPONIBLE`, `RESEAU_INDISPONIBLE`,
    `DONNEES_CARTOGRAPHIQUES_INDISPONIBLES`, `APPLICATION_FERMEE`,
    `SYSTEME_INDISPONIBLE`.
-   `SourceEstimation` : `TRAFIC_RECENT`, `PROFIL_HISTORIQUE`,
    `DUREE_REFERENCE`, `INDISPONIBLE`.

La séparation entre `StatutSession` et `EtatOperationnel` est
obligatoire pour représenter une session métier toujours en cours, mais
temporairement interrompue sur le plan technique.

## 4.3 Sous-domaine : trafic et GPS

``` mermaid
classDiagram
    class ObservationGPS {
        +UUID id
        +DateTime horodatage
        +Double latitude
        +Double longitude
        +Double precision
        +Double vitesse
        +DateTime dateExpiration
        +StatutObservation statut
        +validerQualite()
        +associerSegment()
        +expirer()
        +supprimer()
    }

    class SegmentRoutier {
        +UUID id
        +String identifiantExterne
        +String nom
        +String direction
        +Double longueur
        +JSON geometrie
    }

    class StatistiqueTrafic {
        +UUID id
        +DateTime debutPeriode
        +DateTime finPeriode
        +Double vitesseMoyenne
        +Double vitesseMediane
        +Integer nombreObservations
        +Double niveauConfiance
        +EtatTrafic etat
    }

    class ProfilHistorique {
        +UUID id
        +Integer jourSemaine
        +String plageHoraire
        +Duration dureeTypique
        +Integer nombreEchantillons
        +Double niveauConfiance
    }

    class ConsentementStatistique {
        +UUID id
        +Boolean autorise
        +DateTime dateDecision
        +String versionPolitique
    }

    class ValidateurObservation {
        +valider(observation)
        +rejeter(observation)
    }

    class MoteurAgregationTrafic {
        +aggreger(observations)
        +calculerConfiance()
        +determinerEtatTrafic()
    }

    class StatutObservation {
        <<enumeration>>
        EN_ATTENTE
        VALIDEE
        REJETEE
        EXPIREE
    }

    class EtatTrafic {
        <<enumeration>>
        FLUIDE
        RALENTI
        CONGESTIONNE
        INCONNU
    }

    ObservationGPS "0..*" --> "0..1" SegmentRoutier
    SegmentRoutier "1" --> "0..*" StatistiqueTrafic
    SegmentRoutier "1" --> "0..*" ProfilHistorique
    ValidateurObservation ..> ObservationGPS
    MoteurAgregationTrafic ..> ObservationGPS
    MoteurAgregationTrafic ..> StatistiqueTrafic
```

Le consentement statistique est lié au conducteur et doit conserver
l'historique des décisions. Le diagramme ci-dessus montre la classe de
consentement dans le domaine ; son association avec `Conducteur` est
explicitée dans le modèle global des associations.

## 4.4 Sous-domaine : signalements, incidents et recommandations

``` mermaid
classDiagram
    class Signalement {
        +UUID id
        +DateTime dateCreation
        +Double latitude
        +Double longitude
        +String description
        +DateTime dateExpiration
        +StatutSignalement statut
        +Integer nombreConfirmations
        +Double niveauConfiance
        +soumettre()
        +valider()
        +rejeter()
        +expirer()
    }

    class Incident {
        +UUID id
        +TypeIncident type
        +String description
        +DateTime dateDebut
        +DateTime dateFin
        +StatutIncident statut
        +Double latitude
        +Double longitude
        +Double niveauConfiance
        +confirmer()
        +resoudre()
        +expirer()
    }

    class ConfirmationSignalement {
        +UUID id
        +DateTime dateConfirmation
        +TypeConfirmation type
    }

    class RecommandationItineraire {
        +UUID id
        +DateTime dateCreation
        +DateTime dateExpiration
        +Duration gainTempsEstime
        +Double niveauConfiance
        +DecisionRecommandation decision
        +String motif
        +accepter()
        +ignorer()
        +expirer()
    }

    class MoteurRecommandation {
        +rechercherAlternatives()
        +estimerDurees()
        +comparerItineraires()
        +evaluerPertinence()
        +genererRecommandation()
    }

    class TypeIncident {
        <<enumeration>>
        ACCIDENT
        EMBOUTEILLAGE
        ROUTE_BLOQUEE
        TRAVAUX
        DANGER
        AUTRE
    }

    class StatutSignalement {
        <<enumeration>>
        SOUMIS
        EN_VERIFICATION
        VALIDE
        REJETE
        EXPIRE
    }

    class StatutIncident {
        <<enumeration>>
        DETECTE
        CONFIRME
        EN_COURS
        RESOLU
        EXPIRE
    }

    class TypeConfirmation {
        <<enumeration>>
        CONFIRMATION
        CONTESTATION
    }

    class DecisionRecommandation {
        <<enumeration>>
        EN_ATTENTE
        ACCEPTEE
        IGNOREE
        EXPIREE
    }

    Incident "1" --> "0..*" Signalement
    Signalement "0..*" --> "0..1" Incident
    Incident "1" --> "0..*" ConfirmationSignalement
    RecommandationItineraire "0..*" --> "1" SessionNavigation
    RecommandationItineraire "0..*" --> "1" Itineraire : itinéraire proposé
    MoteurRecommandation ..> RecommandationItineraire
```

**Contraintes :** - Un conducteur ne peut enregistrer qu'une réponse par
incident. - Un incident peut exister sans signalement utilisateur. - Le
diagramme devra distinguer explicitement l'itinéraire actuellement suivi
de l'itinéraire proposé par une recommandation. - Les seuils de
confiance et de transition d'état restent à définir à partir des
exigences.

## 4.5 Sous-domaine : administration et sécurité

``` mermaid
classDiagram
    class Administrateur {
        +UUID id
        +String identifiant
        +String motDePasseHash
        +Boolean actif
        +DateTime dateCreation
        +sAuthentifier()
        +gererConfiguration()
        +consulterAudit()
    }

    class Role {
        +UUID id
        +String nom
        +String description
    }

    class Permission {
        +UUID id
        +String code
        +String description
    }

    class SessionAdministrateur {
        +UUID id
        +DateTime dateDebut
        +DateTime dateExpiration
        +DateTime dateFin
        +Boolean active
        +invalider()
    }

    class Authentification {
        +UUID id
        +DateTime dateTentative
        +Boolean succes
        +String motifEchec
    }

    class ConfigurationSysteme {
        +UUID id
        +String nom
        +String description
        +DateTime dateModification
    }

    class ParametreSysteme {
        +UUID id
        +String cle
        +JSON valeur
        +String description
    }

    class HistoriqueConfiguration {
        +UUID id
        +JSON ancienneValeur
        +JSON nouvelleValeur
        +DateTime dateModification
    }

    class ServiceSysteme {
        +UUID id
        +String nom
        +EtatService etat
    }

    class MetriqueSysteme {
        +UUID id
        +String nom
        +Double valeur
        +String unite
        +DateTime horodatage
    }

    class IncidentTechnique {
        +UUID id
        +String titre
        +String description
        +NiveauGravite gravite
        +StatutIncidentTechnique statut
        +DateTime dateOuverture
        +DateTime dateResolution
    }

    class AlerteTechnique {
        +UUID id
        +String message
        +NiveauGravite gravite
        +DateTime dateCreation
        +Boolean acquittee
    }

    class EvenementTechnique {
        +UUID id
        +String type
        +JSON details
        +DateTime horodatage
    }

    class JournalAudit {
        +UUID id
        +String action
        +String ressource
        +DateTime horodatage
        +JSON details
    }

    class EtatService {
        <<enumeration>>
        DISPONIBLE
        DEGRADE
        INDISPONIBLE
        ARRETE
    }

    class NiveauGravite {
        <<enumeration>>
        FAIBLE
        MOYEN
        ELEVE
        CRITIQUE
    }

    class StatutIncidentTechnique {
        <<enumeration>>
        OUVERT
        EN_COURS
        RESOLU
        CLOTURE
    }

    Administrateur "0..*" -- "0..*" Role
    Role "0..*" -- "0..*" Permission
    Administrateur "1" --> "0..*" SessionAdministrateur
    Administrateur "1" --> "0..*" Authentification
    Administrateur "1" --> "0..*" JournalAudit
    ConfigurationSysteme "1" *-- "1..*" ParametreSysteme
    ParametreSysteme "1" --> "0..*" HistoriqueConfiguration
    Administrateur "1" --> "0..*" HistoriqueConfiguration
    ServiceSysteme "1" --> "0..*" MetriqueSysteme
    ServiceSysteme "1" --> "0..*" IncidentTechnique
    ServiceSysteme "1" --> "0..*" EvenementTechnique
    IncidentTechnique "1" --> "0..*" AlerteTechnique
```

Les rôles et permissions sont en relation plusieurs-à-plusieurs. Les
opérations administratives doivent vérifier la session et la permission
correspondante, puis être auditées.

## 4.6 Sous-domaine : stockage local et synchronisation

``` mermaid
classDiagram
    class BaseLocale {
        +String moteur
        +String versionSchema
        +ouvrir()
        +fermer()
        +executerTransaction()
    }

    class DonneeLocale {
        +UUID id
        +String type
        +JSON contenu
        +DateTime dateCreation
        +DateTime dateModification
    }

    class ServiceSynchronisation {
        +synchroniser()
        +reprendre()
        +traiterFile()
    }

    class FileSynchronisation {
        +UUID id
        +DateTime dateCreation
        +ajouterElement()
        +retirerElement()
    }

    class ElementSynchronisation {
        +UUID id
        +String typeDonnee
        +String identifiantDonnee
        +StatutSynchronisation statut
        +DateTime dateCreation
    }

    class TentativeSynchronisation {
        +UUID id
        +DateTime dateTentative
        +Integer numeroTentative
        +String resultat
    }

    class DemandeSuppression {
        +UUID id
        +String cleIdempotence
        +String identifiantInstallation
        +DateTime dateCreation
        +DateTime prochaineTentative
        +StatutSuppression statut
        +Integer nombreTentatives
        +creer()
        +reessayer()
        +confirmer()
    }

    class ElementSuppression {
        +UUID id
        +String typeDonnee
        +String identifiantDonnee
        +Boolean suppressionLocale
        +Boolean confirmationServeur
    }

    class StatutSynchronisation {
        <<enumeration>>
        EN_ATTENTE
        EN_COURS
        TERMINEE
        EN_ECHEC
    }

    class StatutSuppression {
        <<enumeration>>
        EN_ATTENTE
        EN_TRANSMISSION
        EN_ECHEC_TEMPORAIRE
        CONFIRMEE
    }

    BaseLocale "1" *-- "0..*" DonneeLocale
    FileSynchronisation "1" *-- "0..*" ElementSynchronisation
    ElementSynchronisation "1" *-- "0..*" TentativeSynchronisation
    DemandeSuppression "1" *-- "1..*" ElementSuppression
    ServiceSynchronisation ..> FileSynchronisation
    ServiceSynchronisation ..> DemandeSuppression
```

### Précisions

-   `BaseLocale` et `DonneeLocale` sont des abstractions techniques, pas
    des entités métier.
-   Les identifiants de suppression doivent être limités à
    l'installation concernée.
-   La file de suppression doit survivre aux redémarrages de
    l'application.
-   Les données marquées pour suppression doivent être exclues de la
    synchronisation ordinaire.
-   Le moment exact de la suppression locale par rapport à la
    confirmation serveur doit être confirmé dans les exigences. Le
    système doit en tout état de cause empêcher toute retransmission non
    autorisée.

## 4.7 Associations transversales à intégrer au modèle consolidé

-   `Conducteur 1 -> 0..* ConsentementGPS`.
-   `Conducteur 1 -> 0..* ConsentementStatistique`.
-   Chaque consentement conserve les décisions successives et leur date.
-   `Conducteur 1 -> 0..* Signalement`.
-   `Conducteur 1 -> 0..* ConfirmationSignalement`.
-   Une confirmation est liée à un conducteur et à un incident.
-   `Conducteur 1 -> 0..* DemandeSuppression`, si la traçabilité métier
    de la demande est nécessaire.
-   Une demande de suppression cible un ou plusieurs éléments identifiés
    dans le périmètre de l'installation.
-   `SessionNavigation 1 -> 0..1 ResumeTrajet`.
-   Une recommandation référence une session et un itinéraire proposé,
    distinct de l'itinéraire en cours.

------------------------------------------------------------------------

# 5. Diagrammes de séquence

## 5.1 Séquence 1 : rechercher un itinéraire

``` mermaid
sequenceDiagram
    actor Conducteur
    participant UI as InterfaceNavigation
    participant Consent as GestionnaireConsentement
    participant GPS as ServiceLocalisation
    participant Search as ServiceRechercheItineraire
    participant Engine as MoteurCalculItineraire
    participant Map as FournisseurCartographique
    participant Repo as RepositoryNavigation

    Conducteur->>UI: Saisir destination
    UI->>Consent: Vérifier autorisation GPS système
    Consent-->>UI: Résultat de vérification
    UI->>GPS: Obtenir position actuelle
    GPS-->>UI: Position et précision
    UI->>Search: Rechercher(position, destination)
    Search->>Repo: Enregistrer recherche
    Search->>Engine: Calculer itinéraires
    Engine->>Map: Demander itinéraires
    Map-->>Engine: Itinéraires candidats
    Engine->>Engine: Évaluer et classer
    Engine->>Repo: Enregistrer résultats
    Repo-->>Search: Confirmation
    Search-->>UI: Résultats
    UI-->>Conducteur: Afficher itinéraires

    alt GPS refusé ou position non fiable
        UI-->>Conducteur: Demander autorisation ou nouvelle position
    else Fournisseur indisponible
        UI->>Repo: Vérifier données cartographiques locales
        Repo-->>UI: Disponibilité locale
    else Aucun itinéraire
        UI-->>Conducteur: Informer qu'aucun itinéraire n'est disponible
    end
```

Une recherche ne crée pas encore une session active. La session est
créée lorsque le conducteur démarre effectivement la navigation.

## 5.2 Séquence 2 : démarrer et suivre une navigation

``` mermaid
sequenceDiagram
    actor Conducteur
    participant UI as InterfaceNavigation
    participant Nav as ServiceNavigation
    participant Session as GestionnaireSession
    participant GPS as ServiceLocalisation
    participant Validator as ValidateurObservation
    participant Consent as GestionnaireConsentement
    participant Repo as RepositoryNavigation
    participant Traffic as ServiceTrafic

    Conducteur->>UI: Démarrer navigation
    UI->>GPS: Vérifier permission et disponibilité
    GPS-->>UI: État GPS
    UI->>Nav: Démarrer(itinéraire sélectionné)
    Nav->>Session: Créer session
    Session->>Repo: Persister session
    Repo-->>Session: Confirmation
    Session-->>Nav: Session créée
    Nav->>GPS: Activer suivi de position
    Nav-->>UI: Navigation active

    loop Pendant la navigation
        GPS-->>Nav: Nouvelle position
        Nav->>Validator: Valider position
        Validator-->>Nav: Résultat
        alt Position valide
            Nav-->>UI: Mettre à jour guidage
            Nav->>Consent: Vérifier consentement statistique
            alt Consentement actif
                Nav->>Traffic: Transmettre observation autorisée
            else Consentement absent
                Note over Nav,Traffic: Pas de contribution statistique
            end
        else Position invalide
            Nav-->>UI: Indiquer une position imprécise
        end
    end

    opt Perte réseau
        Nav->>Repo: Vérifier cartes locales
        Repo-->>Nav: Cartes suffisantes ou insuffisantes
    end

    opt Fermeture ou indisponibilité technique
        Nav->>Session: Enregistrer interruption
        Session->>Repo: Persister état et horodatage initial
    end
```

La permission GPS du système et le consentement statistique doivent être
contrôlés séparément. La navigation ne doit pas être conditionnée au
consentement statistique.

## 5.3 Séquence 3 : interruption, restauration et expiration

``` mermaid
sequenceDiagram
    actor Conducteur
    participant App as ApplicationMobile
    participant Session as GestionnaireSession
    participant Detect as DetecteurInterruption
    participant Persist as GestionnairePersistance
    participant GPS as ServiceLocalisation
    participant Map as GestionnaireCartographie
    participant Clock as HorlogeSysteme
    participant History as GestionnaireHistorique

    Detect->>Session: Signaler première interruption
    Session->>Persist: Enregistrer état INTERROMPUE
    Session->>Persist: Enregistrer première interruption
    Session->>Persist: Enregistrer expiration = début + 24 h

    opt Interruptions supplémentaires
        Detect->>Session: Ajouter un motif
        Note over Session: Ne pas réinitialiser le délai
    end

    Conducteur->>App: Rouvrir l'application
    App->>Persist: Charger session persistée
    Persist-->>App: État et horodatages
    App->>Clock: Vérifier temps écoulé et cohérence horloge
    Clock-->>App: Temps fiable ou incertain

    alt Délai supérieur ou égal à 24 h
        App->>Session: Expirer session
        Session->>History: Créer résumé
        History-->>App: Résumé enregistré
        App-->>Conducteur: Session expirée, nouvelle navigation possible
    else Temps écoulé inférieur à 24 h et fiable
        App->>GPS: Vérifier fiabilité GPS
        App->>Map: Vérifier disponibilité des cartes
        GPS-->>App: Résultat GPS
        Map-->>App: Résultat cartographique
        alt GPS fiable et cartes suffisantes
            App->>Session: Reprendre effectivement
            Session->>Persist: Enregistrer reprise
            App-->>Conducteur: Navigation restaurée
        else Conditions insuffisantes
            Note over App,Session: Rester INTERROMPUE, sans faux guidage
            App-->>Conducteur: Navigation temporairement indisponible
        end
    else Temps incertain
        App->>Session: Expiration conservatrice
        Session->>History: Créer résumé si possible
        App-->>Conducteur: Session non restaurable
    end
```

Le délai est calculé depuis la première interruption. L'heure à laquelle
l'application constate l'expiration peut être stockée séparément pour
les diagnostics.

## 5.4 Séquence 4 : collecte, validation et agrégation du trafic

``` mermaid
sequenceDiagram
    participant GPS as ServiceLocalisation
    participant Consent as GestionnaireConsentement
    participant Client as ClientSynchronisation
    participant API as APICollecteTrafic
    participant Validator as ValidateurObservation
    participant Match as ServiceCorrespondanceRoutiere
    participant Aggregate as MoteurAgregationTrafic
    participant Repo as RepositoryTrafic

    GPS->>Consent: Vérifier consentement statistique
    alt Consentement absent
        Consent-->>GPS: Contribution interdite
    else Consentement actif
        Consent-->>GPS: Contribution autorisée
        GPS->>Client: Observation GPS
        Client->>API: Transmettre observation
        API->>Validator: Valider qualité et cohérence
        alt Observation invalide
            Validator-->>API: Rejet
        else Observation valide
            Validator-->>API: Validation
            API->>Match: Identifier segment routier
            Match-->>API: Segment identifié
            API->>Repo: Persister observation contrôlée
            API->>Aggregate: Ajouter à l'agrégation
            Aggregate->>Aggregate: Calculer statistiques et confiance
            Aggregate->>Repo: Enregistrer statistiques agrégées
        end
    end
```

Règles : déduplication, contrôle de fraîcheur, seuils configurables,
exclusion des observations expirées et retrait du consentement respecté
avant toute synchronisation en attente.

## 5.5 Séquence 5 : signaler et confirmer un incident

``` mermaid
sequenceDiagram
    actor Driver1 as Conducteur déclarant
    actor Driver2 as Autre conducteur
    participant UI as InterfaceSignalement
    participant Service as ServiceSignalement
    participant API as APIIncident
    participant Validator as ValidateurSignalement
    participant Detector as ServiceDetectionIncident
    participant Incident as GestionnaireIncident
    participant Trust as GestionnaireConfiance
    participant Repo as RepositoryIncident

    Driver1->>UI: Déclarer incident
    UI->>Service: Envoyer type, description, position
    Service->>API: Soumettre signalement
    API->>Validator: Valider données
    Validator-->>API: Résultat

    alt Signalement invalide
        API-->>UI: Rejet et motif
    else Signalement valide
        API->>Detector: Rechercher incident correspondant
        Detector->>Repo: Rechercher incidents proches
        Repo-->>Detector: Résultats
        alt Incident existant
            Detector->>Incident: Associer signalement
        else Aucun incident correspondant
            Detector->>Incident: Créer incident
        end
        Incident->>Trust: Recalculer confiance
        Trust->>Repo: Enregistrer état et confiance
        Repo-->>UI: Confirmation de soumission
    end

    opt Confirmation ou contestation par un autre conducteur
        Driver2->>UI: Confirmer ou contester
        UI->>API: Envoyer réponse
        API->>Validator: Vérifier unicité conducteur/incident
        Validator-->>API: Résultat
        API->>Trust: Recalculer confiance
        Trust->>Incident: Proposer mise à jour
        Incident->>Repo: Persister évolution
    end
```

Les seuils de confiance et les transitions automatiques doivent être
confirmés par les exigences.

## 5.6 Séquence 6 : recommandations d'itinéraires

``` mermaid
sequenceDiagram
    actor Conducteur
    participant UI as InterfaceNavigation
    participant Reco as ServiceRecommandation
    participant Session as GestionnaireSession
    participant Traffic as ServiceTrafic
    participant Incident as ServiceIncident
    participant Search as ServiceRechercheItineraire
    participant Estimate as MoteurEstimationDuree
    participant Engine as MoteurRecommandation
    participant Repo as RepositoryRecommandation

    Reco->>Session: Obtenir session active et route courante
    Session-->>Reco: Session et itinéraire courant
    Reco->>Traffic: Obtenir conditions de trafic
    Traffic-->>Reco: Données trafic
    Reco->>Incident: Obtenir incidents pertinents
    Incident-->>Reco: Incidents
    Reco->>Search: Rechercher alternatives
    Search-->>Reco: Itinéraires candidats
    Reco->>Estimate: Estimer durées
    Estimate-->>Reco: Durées et confiance
    Reco->>Engine: Comparer et évaluer
    alt Alternative pertinente et confiance suffisante
        Engine-->>Reco: Recommandation
        Reco->>Repo: Enregistrer recommandation
        Reco-->>UI: Présenter alternative
        Conducteur->>UI: Accepter ou ignorer
        UI->>Reco: Enregistrer décision
        opt Recommandation acceptée et toujours valide
            Reco->>Session: Mettre à jour itinéraire suivi
        end
    else Aucune alternative suffisamment fiable
        Reco-->>UI: Aucune recommandation
    end
```

Le modèle doit distinguer l'itinéraire courant de l'itinéraire proposé.
Une recommandation périmée ne doit pas être acceptée.

## 5.7 Séquence 7 : synchronisation et mode hors ligne

``` mermaid
sequenceDiagram
    actor Conducteur
    participant UI as InterfaceNavigation
    participant Network as GestionnaireReseau
    participant Sync as ServiceSynchronisation
    participant Local as BaseLocale
    participant Queue as FileSynchronisation
    participant Delete as GestionnaireSuppression
    participant API as APIBackend
    participant Retry as GestionnaireRetry

    Network->>Sync: État réseau
    alt Hors ligne
        Sync->>Local: Conserver les données locales
        Sync->>Queue: Maintenir les éléments en attente
    else En ligne
        Sync->>Queue: Charger demandes en attente
        Sync->>Delete: Traiter suppressions prioritaires
        Delete->>API: Envoyer demandes idempotentes
        API-->>Delete: Résultat ou confirmation
        alt Suppression confirmée
            Delete->>Local: Mettre à jour état de demande
        else Échec temporaire
            Delete->>Retry: Planifier backoff exponentiel
        end
        Sync->>Queue: Exclure les éléments en suppression
        Sync->>API: Transmettre données ordinaires autorisées
        API-->>Sync: Accusé de réception
        Sync->>Local: Mettre à jour état de synchronisation
    end
```

La priorité des suppressions sur les synchronisations ordinaires est une
recommandation de conception destinée à empêcher la retransmission de
données qui doivent être supprimées.

## 5.8 Séquence 8 : consentements et suppression des données

``` mermaid
sequenceDiagram
    actor Conducteur
    participant UI as InterfaceConfidentialite
    participant Consent as GestionnaireConsentement
    participant Delete as GestionnaireSuppression
    participant Local as BaseLocale
    participant Queue as FileSynchronisation
    participant API as APIConfidentialite
    participant Server as GestionnaireSuppressionServeur
    participant Notify as GestionnaireNotification

    Conducteur->>UI: Retirer consentement statistique
    UI->>Consent: Enregistrer retrait
    Consent->>Local: Persister décision
    Consent->>Delete: Déclencher suppression observations concernées
    Delete->>Local: Supprimer ou neutraliser données locales concernées
    Delete->>Queue: Créer demande persistante
    Queue->>API: Transmettre demande
    API->>Server: Traiter demande idempotente
    Server-->>API: Confirmation ou erreur

    alt Confirmation explicite
        API-->>Queue: Suppression confirmée
        Queue->>Local: Marquer demande confirmée
        Notify-->>Conducteur: Notification de succès
    else Erreur temporaire
        Queue->>Queue: Programmer nouvelle tentative
        opt Blocage persistant nécessitant attention
            Notify-->>Conducteur: Notification sans coordonnées
        end
    end
```

Le retrait du consentement statistique n'implique pas automatiquement
l'arrêt de la navigation GPS.

## 5.9 Séquence 9 : authentification administrateur et permissions

``` mermaid
sequenceDiagram
    actor Admin as Administrateur
    participant UI as InterfaceAdministration
    participant Auth as ServiceAuthentification
    participant Repo as RepositoryAdmin
    participant Role as GestionnaireRole
    participant Session as GestionnaireSessionAdmin
    participant Audit as JournalAudit

    Admin->>UI: Saisir identifiants
    UI->>Auth: Demander authentification
    Auth->>Repo: Charger compte
    Repo-->>Auth: Données du compte
    Auth->>Auth: Vérifier authentifiants
    alt Authentification réussie
        Auth->>Role: Charger rôles et permissions
        Role-->>Auth: Permissions
        Auth->>Session: Créer session administrateur
        Session-->>Auth: Session active
        Auth->>Audit: Journaliser succès
        Auth-->>UI: Accès autorisé
        Admin->>UI: Demander opération
        UI->>Role: Vérifier permission
        alt Permission accordée
            Role-->>UI: Autorisation
            UI->>Audit: Journaliser action sensible
        else Permission refusée
            Role-->>UI: Refus
            UI->>Audit: Journaliser refus
        end
    else Échec
        Auth->>Audit: Journaliser échec
        Auth-->>UI: Accès refusé
    end
```

Chaque opération sensible doit être contrôlée côté serveur. La
déconnexion invalide la session côté serveur.

## 5.10 Séquence 10 : supervision et incidents techniques

``` mermaid
sequenceDiagram
    participant Agent as AgentSupervision
    participant Service as ServiceSysteme
    participant Metrics as CollecteurMetriques
    participant Detect as DetecteurAnomalies
    participant Incident as GestionnaireIncidentTechnique
    participant Alert as GestionnaireAlerte
    participant Notify as GestionnaireNotification
    actor Admin as Administrateur
    participant Log as JournalTechnique

    loop Surveillance périodique
        Agent->>Service: Vérifier santé
        Agent->>Metrics: Collecter métriques
        Metrics-->>Detect: Valeurs observées
        Service-->>Detect: État du service
        Detect->>Log: Enregistrer événements
        alt Anomalie détectée
            Detect->>Incident: Créer ou actualiser incident
            Incident->>Alert: Générer alerte selon gravité
            Alert->>Notify: Demander notification
            Notify-->>Admin: Alerte technique
            Admin->>Incident: Examiner et traiter
            Incident->>Log: Enregistrer résolution
        end
    end
```

Métriques candidates : CPU, mémoire, espace disque, latence API, taux
d'erreurs, disponibilité des services, échecs de synchronisation et
retard des files.

------------------------------------------------------------------------

# 6. Diagrammes d'activité

## 6.1 Activité 1 : processus global de navigation

``` mermaid
flowchart TD
    A([Début]) --> B[Ouvrir application]
    B --> C[Accéder à la navigation]
    C --> D[Saisir destination]
    D --> E{Destination valide ?}
    E -- Non --> D
    E -- Oui --> F{Permission GPS accordée ?}
    F -- Non --> G[Demander permission]
    G --> F
    F -- Oui --> H[Obtenir position fiable]
    H --> I{Position disponible ?}
    I -- Non --> J[Informer conducteur]
    J --> H
    I -- Oui --> K[Rechercher itinéraires]
    K --> L{Résultats disponibles ?}
    L -- Non --> M[Informer conducteur]
    M --> K
    L -- Oui --> N[Afficher itinéraires]
    N --> O[Conducteur sélectionne un itinéraire]
    O --> P[Créer session de navigation]
    P --> Q[Activer suivi GPS]
    Q --> R[Mettre à jour guidage]
    R --> S{Destination atteinte ?}
    S -- Oui --> T[Terminer session et créer résumé]
    T --> Z([Fin])
    S -- Non --> U{Interruption technique ?}
    U -- Non --> V{Recalcul nécessaire ?}
    V -- Oui --> K
    V -- Non --> R
    U -- Oui --> W[Persister session et première interruption]
    W --> X{Conditions de reprise satisfaites avant 24 h ?}
    X -- Oui --> Y[Restaurer navigation]
    Y --> R
    X -- Non --> AA{24 h écoulées ou temps incertain ?}
    AA -- Non --> AB[Attendre et réévaluer]
    AB --> X
    AA -- Oui --> AC[Expirer session et créer résumé]
    AC --> Z
```

## 6.2 Activité 2 : collecte et traitement du trafic

``` mermaid
flowchart TD
    A([Début]) --> B[Obtenir observation GPS]
    B --> C{Consentement statistique actif ?}
    C -- Non --> D[Ne pas contribuer aux statistiques]
    D --> Z([Fin])
    C -- Oui --> E[Créer observation]
    E --> F[Valider coordonnées, heure, précision et vitesse]
    F --> G{Observation valide ?}
    G -- Non --> H[Rejeter observation]
    H --> Z
    G -- Oui --> I[Identifier segment routier]
    I --> J{Segment identifié ?}
    J -- Non --> K[Écarter ou différer selon politique]
    K --> Z
    J -- Oui --> L[Persister observation autorisée]
    L --> M{Internet disponible ?}
    M -- Non --> N[Mettre en attente locale]
    N --> O[Attendre réseau]
    O --> M
    M -- Oui --> P[Transmettre au serveur]
    P --> Q{Transmission réussie ?}
    Q -- Non --> R[Programmer nouvelle tentative]
    R --> M
    Q -- Oui --> S[Dédupliquer et enregistrer]
    S --> T[Regrouper par segment et période]
    T --> U{Volume et qualité suffisants ?}
    U -- Non --> V[Conserver confiance faible ou état inconnu]
    U -- Oui --> W[Calculer statistiques et confiance]
    W --> X[Déterminer état du trafic]
    V --> Y[Persister résultat agrégé]
    X --> Y
    Y --> Z
```

## 6.3 Activité 3 : signaler et gérer un incident

``` mermaid
flowchart TD
    A([Début]) --> B[Conducteur saisit un signalement]
    B --> C[Valider les champs et la position]
    C --> D{Signalement valide ?}
    D -- Non --> E[Rejeter et informer]
    E --> Z([Fin])
    D -- Oui --> F[Rechercher incident correspondant]
    F --> G{Incident existant ?}
    G -- Oui --> H[Associer signalement à incident]
    G -- Non --> I[Créer incident]
    H --> J[Mettre à jour éléments de confiance]
    I --> J
    J --> K[Attendre confirmations ou contestations]
    K --> L[Contrôler unicité de la réponse du conducteur]
    L --> M[Recalculer confiance]
    M --> N{Règle de transition satisfaite ?}
    N -- Oui --> O[Mettre à jour état incident]
    N -- Non --> P[Conserver état courant]
    O --> Q[Surveiller évolution et expiration]
    P --> Q
    Q --> R{Incident résolu ou expiré ?}
    R -- Non --> K
    R -- Oui --> Z
```

## 6.4 Activité 4 : recommandation d'itinéraire

``` mermaid
flowchart TD
    A([Début]) --> B[Obtenir session et itinéraire courant]
    B --> C[Obtenir trafic et incidents]
    C --> D[Rechercher itinéraires alternatifs]
    D --> E[Estimer durées]
    E --> F[Comparer alternatives]
    F --> G{Alternative pertinente et confiance suffisante ?}
    G -- Non --> H[Ne pas générer de recommandation]
    H --> Z([Fin])
    G -- Oui --> I[Créer recommandation]
    I --> J[Présenter au conducteur]
    J --> K{Décision du conducteur}
    K -- Ignorer --> L[Marquer IGNOREE]
    K -- Accepter --> M{Recommandation toujours valide ?}
    M -- Non --> N[Marquer EXPIREE]
    M -- Oui --> O[Mettre à jour itinéraire de session]
    L --> Z
    N --> Z
    O --> Z
```

## 6.5 Activité 5 : synchronisation et mode hors ligne

``` mermaid
flowchart TD
    A([Début]) --> B[Détecter réseau]
    B --> C{Connexion disponible ?}
    C -- Non --> D[Conserver données localement]
    D --> E[Maintenir files persistantes]
    E --> B
    C -- Oui --> F[Charger demandes de suppression]
    F --> G[Traiter suppressions en priorité]
    G --> H{Confirmation serveur ?}
    H -- Non --> I[Backoff exponentiel et nouvelle tentative]
    I --> B
    H -- Oui --> J[Marquer suppression confirmée]
    J --> K[Exclure données supprimées de la synchronisation ordinaire]
    K --> L[Transmettre données ordinaires autorisées]
    L --> M{Transmission réussie ?}
    M -- Non --> N[Maintenir élément en attente]
    N --> B
    M -- Oui --> O[Mettre à jour statut de synchronisation]
    O --> Z([Fin])
```

## 6.6 Activité 6 : consentement et suppression

``` mermaid
flowchart TD
    A([Début]) --> B[Conducteur ouvre confidentialité]
    B --> C[Consulter consentements]
    C --> D{Action demandée ?}
    D -- Modifier GPS --> E[Enregistrer décision GPS]
    D -- Modifier statistique --> F[Enregistrer décision statistique]
    D -- Retirer statistique --> G[Arrêter nouvelles contributions]
    G --> H[Identifier observations concernées]
    H --> I[Supprimer ou neutraliser les données locales concernées]
    I --> J[Créer demande idempotente et persistante]
    J --> K[Transmettre au serveur lorsque possible]
    K --> L{Confirmation explicite ?}
    L -- Non --> M[Réessayer avec backoff exponentiel]
    M --> K
    L -- Oui --> N[Marquer demande confirmée]
    N --> O[Notifier sans coordonnées GPS]
    E --> Z([Fin])
    F --> Z
    O --> Z
```

## 6.7 Activité 7 : authentification et permissions administratives

``` mermaid
flowchart TD
    A([Début]) --> B[Administrateur saisit identifiants]
    B --> C[Vérifier identité]
    C --> D{Authentification réussie ?}
    D -- Non --> E[Journaliser échec]
    E --> Z([Fin])
    D -- Oui --> F[Charger rôles et permissions]
    F --> G[Créer session administrateur]
    G --> H[Journaliser connexion]
    H --> I[Administrateur demande une opération]
    I --> J[Vérifier session et permission]
    J --> K{Permission accordée ?}
    K -- Non --> L[Refuser et journaliser]
    L --> I
    K -- Oui --> M[Exécuter opération]
    M --> N[Journaliser action sensible]
    N --> O{Déconnexion ?}
    O -- Non --> I
    O -- Oui --> P[Invalider session côté serveur]
    P --> Z
```

## 6.8 Activité 8 : supervision

``` mermaid
flowchart TD
    A([Début]) --> B[Collecter métriques et états]
    B --> C[Analyser anomalies]
    C --> D{Anomalie détectée ?}
    D -- Non --> B
    D -- Oui --> E[Créer ou actualiser incident technique]
    E --> F[Évaluer gravité]
    F --> G[Créer alerte]
    G --> H[Notifier administrateur]
    H --> I[Administrateur examine incident]
    I --> J[Appliquer correction]
    J --> K{Service rétabli ?}
    K -- Non --> I
    K -- Oui --> L[Résoudre incident]
    L --> M[Journaliser résolution]
    M --> B
```

------------------------------------------------------------------------

# 7. Diagrammes d'états-transitions

## 7.1 États d'une session de navigation

Le statut métier et l'état opérationnel sont séparés. Le diagramme
suivant se concentre sur les transitions opérationnelles d'une session
encore en cours.

``` mermaid
stateDiagram-v2
    [*] --> Active
    Active --> Interrompue: Première interruption / enregistrer T0
    Interrompue --> Interrompue: Nouvelle cause / ne pas modifier T0
    Interrompue --> RestaurationEnAttente: Application rouverte
    RestaurationEnAttente --> Active: GPS fiable et cartes suffisantes avant 24 h
    RestaurationEnAttente --> Interrompue: Conditions de reprise insuffisantes
    Interrompue --> Expiree: 24 h écoulées
    RestaurationEnAttente --> Expiree: Délai dépassé ou temps incertain
    Active --> Terminee: Destination atteinte ou fin volontaire
    Active --> Annulee: Annulation volontaire
    Terminee --> [*]
    Annulee --> [*]
    Expiree --> [*]
```

Règles : - La première interruption définit `T0`. - L'expiration
théorique est `T0 + 24 heures`. - Une interruption additionnelle ne
réinitialise pas `T0`. - Seule une reprise effective rétablit l'état
actif. - Une session expirée n'est plus restaurable.

## 7.2 États d'un incident

``` mermaid
stateDiagram-v2
    [*] --> Detecte
    Detecte --> Confirme: Éléments suffisants
    Detecte --> EnCours: Prise en charge
    Confirme --> EnCours: Suivi opérationnel
    EnCours --> Resolu: Incident terminé
    Detecte --> Expire: Expiration
    Confirme --> Expire: Expiration
    Resolu --> [*]
    Expire --> [*]
```

Les transitions automatiques, seuils et délais doivent être définis par
les exigences ou par des paramètres administrables.

## 7.3 États d'une demande de suppression

``` mermaid
stateDiagram-v2
    [*] --> EnAttente
    EnAttente --> EnTransmission: Envoi au serveur
    EnTransmission --> Confirmee: Confirmation explicite
    EnTransmission --> EchecTemporaire: Erreur temporaire
    EchecTemporaire --> EnAttente: Backoff écoulé
    Confirmee --> [*]
```

Une demande ne passe à `CONFIRMEE` qu'après une confirmation explicite
du serveur. Les tentatives sont répétées sans abandon automatique.

## 7.4 États d'un signalement

``` mermaid
stateDiagram-v2
    [*] --> Soumis
    Soumis --> EnVerification: Contrôle démarré
    EnVerification --> Valide: Signalement validé
    EnVerification --> Rejete: Signalement rejeté
    Soumis --> Expire: Délai dépassé
    EnVerification --> Expire: Délai dépassé
    Valide --> [*]
    Rejete --> [*]
    Expire --> [*]
```

Un signalement validé peut être associé à un incident, mais ne rend pas
automatiquement cet incident confirmé.

## 7.5 États d'une recommandation

``` mermaid
stateDiagram-v2
    [*] --> EnAttente
    EnAttente --> Acceptee: Conducteur accepte et recommandation valide
    EnAttente --> Ignoree: Conducteur ignore
    EnAttente --> Expiree: Date limite atteinte
    EnAttente --> Expiree: Itinéraire ou contexte devenu invalide
    Acceptee --> [*]
    Ignoree --> [*]
    Expiree --> [*]
```

------------------------------------------------------------------------

# 8. Diagrammes de composants

## 8.1 Architecture globale

``` mermaid
flowchart TB
    subgraph MOBILE["Application mobile"]
        UI["Interface utilisateur"]
        NAV["Module navigation"]
        GPS["Service GPS"]
        MAP["Gestionnaire cartographique"]
        LOCAL[("Base locale SQLite")]
        SYNC["Gestionnaire synchronisation"]
        PRIV["Gestionnaire confidentialité"]
    end

    subgraph BACKEND["Backend / API"]
        API["API REST"]
        AUTH["Authentification"]
        NAVS["Service navigation"]
        TRAFFIC["Service trafic"]
        INCIDENT["Service incidents"]
        RECO["Service recommandations"]
        PRIVS["Service suppressions et consentements"]
        ADMIN["Administration"]
        MON["Supervision"]
    end

    subgraph DATA["Persistance serveur"]
        DB[("Base principale")]
        AUDIT[("Journaux et audits")]
        QUEUE[("File de traitement")]
    end

    subgraph EXTERNAL["Services externes"]
        CARTO["Fournisseur cartographique"]
        NOTIF["Service notifications"]
    end

    UI --> NAV
    NAV --> GPS
    NAV --> MAP
    NAV --> LOCAL
    SYNC <--> LOCAL
    PRIV --> LOCAL
    SYNC <--> API
    API --> AUTH
    API --> NAVS
    API --> TRAFFIC
    API --> INCIDENT
    API --> RECO
    API --> PRIVS
    API --> ADMIN
    API --> MON
    NAVS --> DB
    TRAFFIC --> DB
    INCIDENT --> DB
    RECO --> DB
    PRIVS --> DB
    ADMIN --> AUDIT
    MON --> AUDIT
    PRIVS --> QUEUE
    QUEUE --> NOTIF
    NAVS <--> CARTO
```

Cette architecture est modulaire. Elle n'impose pas d'utiliser des
microservices dès la première version.

## 8.2 Architecture détaillée du backend

``` mermaid
flowchart TB
    subgraph API_LAYER["Couche présentation / API"]
        ROUTER["Routeur REST"]
        MIDDLEWARE["Middleware authentification"]
        VALIDATOR["Validation des entrées"]
        CONTROLLER["Contrôleurs"]
    end

    subgraph APP_LAYER["Couche application"]
        UC_NAV["Cas d'utilisation navigation"]
        UC_TRAFFIC["Cas d'utilisation trafic"]
        UC_INCIDENT["Cas d'utilisation incidents"]
        UC_RECO["Cas d'utilisation recommandations"]
        UC_PRIV["Cas d'utilisation confidentialité"]
        UC_ADMIN["Cas d'utilisation administration"]
        UC_MON["Cas d'utilisation supervision"]
    end

    subgraph DOMAIN_LAYER["Couche domaine"]
        D_NAV["Domaine navigation"]
        D_TRAFFIC["Domaine trafic"]
        D_INCIDENT["Domaine incidents"]
        D_RECO["Domaine recommandations"]
        D_PRIV["Domaine confidentialité"]
        D_SECURITY["Domaine sécurité"]
    end

    subgraph INFRA_LAYER["Infrastructure"]
        REPO["Repositories"]
        DB["Adaptateur base de données"]
        CACHE["Adaptateur cache"]
        MQ["Adaptateur file de messages"]
        MAP["Adaptateur cartographique"]
        NOTIF["Adaptateur notification"]
        AUDIT["Adaptateur audit"]
    end

    ROUTER --> MIDDLEWARE
    MIDDLEWARE --> VALIDATOR
    VALIDATOR --> CONTROLLER
    CONTROLLER --> APP_LAYER
    APP_LAYER --> DOMAIN_LAYER
    APP_LAYER --> REPO
    REPO --> DB
    APP_LAYER --> CACHE
    APP_LAYER --> MQ
    APP_LAYER --> MAP
    APP_LAYER --> NOTIF
    APP_LAYER --> AUDIT
```

Principes : - les contrôleurs ne portent pas les règles métier ; - les
repositories isolent la persistance ; - les domaines limitent les
dépendances directes ; - les traitements longs sont asynchrones ; - les
permissions sont contrôlées côté serveur ; - les suppressions sont
idempotentes.

## 8.3 Architecture détaillée de l'application mobile

``` mermaid
flowchart TB
    subgraph UI["Couche présentation"]
        HOME["Écran principal"]
        NAV_UI["Interface navigation"]
        TRAFFIC_UI["Interface trafic"]
        INCIDENT_UI["Interface signalement"]
        HISTORY_UI["Historique trajets"]
        SETTINGS_UI["Paramètres et confidentialité"]
    end

    subgraph APP["Couche application"]
        NAV["Gestionnaire navigation"]
        ROUTE["Recherche itinéraires"]
        RECO["Gestionnaire recommandations"]
        INCIDENT["Gestionnaire signalements"]
        SESSION["Gestionnaire sessions"]
    end

    subgraph DEVICE["Services du téléphone"]
        GPS["Service GPS"]
        PERMISSION["Gestionnaire permissions"]
        NETWORK["Détection réseau"]
        NOTIF["Notifications locales"]
    end

    subgraph DATA["Stockage local"]
        SQLITE[("SQLite")]
        MAP_CACHE[("Cache cartographique")]
        SYNC_QUEUE[("File de synchronisation")]
    end

    subgraph SERVICES["Services techniques"]
        MAP["Gestionnaire cartes"]
        OBS["Gestionnaire observations GPS"]
        SYNC["Service synchronisation"]
        PRIVACY["Gestionnaire consentements"]
        RESTORE["Service restauration session"]
    end

    API["API Backend"]
    CARTO["Fournisseur cartographique"]

    HOME --> NAV_UI
    HOME --> TRAFFIC_UI
    HOME --> INCIDENT_UI
    HOME --> HISTORY_UI
    HOME --> SETTINGS_UI
    NAV_UI --> NAV
    NAV_UI --> ROUTE
    NAV --> SESSION
    NAV --> GPS
    NAV --> MAP
    NAV --> RECO
    GPS --> PERMISSION
    GPS --> OBS
    NETWORK --> SYNC
    TRAFFIC_UI --> OBS
    INCIDENT_UI --> INCIDENT
    HISTORY_UI --> SQLITE
    SETTINGS_UI --> PRIVACY
    SESSION --> SQLITE
    RESTORE --> SQLITE
    MAP --> MAP_CACHE
    MAP --> CARTO
    OBS --> SQLITE
    SYNC --> SYNC_QUEUE
    SYNC --> SQLITE
    SYNC <--> API
    PRIVACY --> SYNC_QUEUE
    PRIVACY --> SQLITE
    NOTIF --> HOME
```

Structure indicative de code mobile :

``` text
mobile/
├── src/
│   ├── app/
│   │   ├── screens/
│   │   ├── navigation/
│   │   └── components/
│   ├── modules/
│   │   ├── navigation/
│   │   ├── traffic/
│   │   ├── incidents/
│   │   ├── recommendations/
│   │   ├── privacy/
│   │   └── history/
│   ├── services/
│   │   ├── gps/
│   │   ├── maps/
│   │   ├── notifications/
│   │   ├── synchronization/
│   │   └── permissions/
│   ├── database/
│   │   ├── migrations/
│   │   ├── repositories/
│   │   └── schema/
│   ├── core/
│   │   ├── api/
│   │   ├── security/
│   │   └── utils/
│   └── main.tsx
└── package.json
```

Cette structure est indicative d'une application mobile de type React
Native/Expo ; le framework reste à confirmer.

## 8.4 Architecture des systèmes de persistance

``` mermaid
flowchart TB
    subgraph MOBILE["Application mobile"]
        NAV["Gestionnaire navigation"]
        GPS["Gestionnaire observations GPS"]
        SYNC["Service synchronisation"]
        PRIV["Gestionnaire suppression"]
        SQLITE[("SQLite")]
        LOCAL_QUEUE[("File locale")]
        MAP_CACHE[("Cache cartographique")]
    end

    subgraph BACKEND["Backend"]
        API["API REST"]
        REPO["Repositories"]
        TRAFFIC["Service trafic"]
        INCIDENT["Service incidents"]
        NAV_SERVICE["Service navigation"]
        PRIV_SERVICE["Service confidentialité"]
        MONITOR["Service supervision"]
    end

    subgraph STORAGE["Stockage serveur"]
        PG[("PostgreSQL")]
        REDIS[("Redis")]
        AUDIT[("Audits")]
        LOGS[("Journaux techniques")]
        SERVER_QUEUE[("File asynchrone")]
    end

    NAV --> SQLITE
    GPS --> SQLITE
    SYNC --> SQLITE
    PRIV --> SQLITE
    SYNC --> LOCAL_QUEUE
    NAV --> MAP_CACHE
    SYNC <--> API
    PRIV --> API
    API --> REPO
    REPO --> PG
    TRAFFIC --> PG
    INCIDENT --> PG
    NAV_SERVICE --> PG
    PRIV_SERVICE --> PG
    API --> REDIS
    REPO --> REDIS
    PRIV_SERVICE --> SERVER_QUEUE
    MONITOR --> LOGS
    MONITOR --> AUDIT
    API --> AUDIT
```

Technologies proposées, à confirmer : - SQLite pour le stockage mobile
; - PostgreSQL pour les données métier ; - Redis pour le cache et
éventuellement la distribution de tâches ; - une file de messages
adaptée aux traitements asynchrones ; - un stockage de journaux adapté
au volume et à la politique de conservation.

## 8.5 Intégrations externes et communications

``` mermaid
flowchart TB
    subgraph MOBILE["Application mobile"]
        UI["Interface mobile"]
        GPS["Adaptateur GPS"]
        MAP["Adaptateur cartographique"]
        LOCAL_NOTIF["Notifications locales"]
        API_CLIENT["Client API"]
    end

    subgraph BACKEND["Backend"]
        API["API REST"]
        ROUTE["Service itinéraires"]
        GEO["Service géographique"]
        TRAFFIC["Service trafic"]
        AUTH["Service authentification"]
        NOTIF["Service notification"]
    end

    subgraph EXTERNAL["Services externes"]
        OS_GPS["Services GPS Android"]
        MAP_PROVIDER["Fournisseur cartographique"]
        GEO_PROVIDER["Fournisseur géocodage"]
        PUSH["Service Push"]
        IDENTITY["Fournisseur identité externe"]
        TIME["Référence temporelle serveur"]
    end

    UI --> GPS
    GPS <--> OS_GPS
    UI --> MAP
    MAP <--> MAP_PROVIDER
    UI --> API_CLIENT
    API_CLIENT <--> API
    API --> ROUTE
    ROUTE <--> MAP_PROVIDER
    API --> GEO
    GEO <--> GEO_PROVIDER
    API --> TRAFFIC
    API --> AUTH
    AUTH <--> IDENTITY
    API --> NOTIF
    NOTIF --> PUSH
    PUSH --> LOCAL_NOTIF
    API --> TIME
```

Les adaptateurs évitent de coupler le cœur métier à un fournisseur
unique. Les clés et secrets ne doivent pas être intégrés en clair dans
le code source mobile.

------------------------------------------------------------------------

# 9. Diagrammes de déploiement

## 9.1 Déploiement global

``` mermaid
flowchart TB
    subgraph PHONE["Device : Smartphone Android"]
        OS["Android OS"]
        APP["Application mobile"]
        SQLITE[("SQLite")]
        CACHE[("Cache cartographique")]
        OS --> APP
        APP --> SQLITE
        APP --> CACHE
    end

    subgraph SERVER["Node : Serveur Backend"]
        RUNTIME["Runtime backend"]
        API["API REST"]
        SERVICES["Services métier"]
        WORKER["Workers asynchrones"]
        RUNTIME --> API
        API --> SERVICES
        SERVICES --> WORKER
    end

    subgraph DATABASE["Node : Serveur de données"]
        PG[("PostgreSQL")]
        REDIS[("Redis")]
        LOGS[("Journaux et audits")]
    end

    subgraph EXTERNAL["Node : Services externes"]
        MAP["Fournisseur cartographique"]
        PUSH["Service Push"]
        GEO["Service géocodage"]
    end

    APP <-->|HTTPS| API
    SERVICES <--> PG
    SERVICES <--> REDIS
    WORKER <--> LOGS
    API <--> MAP
    API <--> GEO
    WORKER --> PUSH
```

## 9.2 Infrastructure détaillée du backend

``` mermaid
flowchart TB
    CLIENT["Application mobile / Navigateur administrateur"]

    subgraph INFRA["Infrastructure backend"]
        PROXY["Reverse Proxy"]
        API["Serveur API"]
        WORKER["Serveur Worker"]
        subgraph API_PROCESS["Processus API"]
            AUTH["Authentification"]
            NAV["Navigation"]
            TRAFFIC["Trafic"]
            INCIDENT["Incidents"]
            RECO["Recommandations"]
            PRIVACY["Confidentialité"]
            ADMIN["Administration"]
        end
        subgraph WORKER_PROCESS["Processus Worker"]
            SYNC["Traitement synchronisation"]
            AGG["Agrégation trafic"]
            DELETE["Traitement suppressions"]
            NOTIF["Traitement notifications"]
            MONITOR["Supervision"]
        end
    end

    subgraph DATA["Infrastructure de données"]
        PG[("PostgreSQL")]
        REDIS[("Redis / Cache")]
        QUEUE[("File de messages")]
        LOGS[("Journaux techniques")]
        AUDIT[("Journaux d'audit")]
    end

    CLIENT -->|HTTPS| PROXY
    PROXY -->|HTTP interne sécurisé| API
    API --> API_PROCESS
    API_PROCESS --> PG
    API_PROCESS --> REDIS
    API_PROCESS --> QUEUE
    API_PROCESS --> AUDIT
    QUEUE --> WORKER
    WORKER --> WORKER_PROCESS
    WORKER_PROCESS --> PG
    WORKER_PROCESS --> REDIS
    WORKER_PROCESS --> LOGS
    WORKER_PROCESS --> AUDIT
```

L'API et les workers peuvent être répliqués indépendamment si la charge
augmente. Un déploiement initial sous forme de monolithe modulaire reste
possible.

## 9.3 Déploiement détaillé de l'application mobile

``` mermaid
flowchart TB
    subgraph DEVICE["Device : Smartphone"]
        subgraph ANDROID["Android OS"]
            GPS["Location Services"]
            PERMISSION["Permission Manager"]
            NETWORK["Network Manager"]
            PUSH["Notification Manager"]
            BACKGROUND["Background Execution"]
        end

        subgraph APP["Application mobile"]
            UI["Interface utilisateur"]
            NAV["Module navigation"]
            SESSION["Gestionnaire de sessions"]
            MAP["Gestionnaire cartographique"]
            SYNC["Service synchronisation"]
            PRIVACY["Gestionnaire confidentialité"]
        end

        subgraph STORAGE["Stockage local"]
            SQLITE[("SQLite")]
            MAPCACHE[("Cache cartographique")]
            QUEUE[("File synchronisation")]
        end
    end

    API["Serveur Backend"]
    GPS --> NAV
    PERMISSION --> GPS
    NETWORK --> SYNC
    PUSH --> UI
    BACKGROUND --> SYNC
    UI --> NAV
    NAV --> SESSION
    NAV --> MAP
    SESSION --> SQLITE
    MAP --> MAPCACHE
    SYNC --> QUEUE
    PRIVACY --> SQLITE
    PRIVACY --> QUEUE
    SYNC <-->|HTTPS| API
```

Sur Android, le suivi en arrière-plan peut nécessiter un service de
premier plan et une notification persistante selon la version du système
et les règles de plateforme. Les permissions doivent être gérées
explicitement.

## 9.4 Communications réseau et sécurité

``` mermaid
flowchart TB
    DRIVER["Conducteur"]
    ADMIN["Administrateur"]

    subgraph CLIENT["Smartphone Android"]
        APP["Application mobile"]
        TOKENS["Gestion des jetons"]
        SQLITE[("SQLite")]
        QUEUE[("File locale")]
    end

    subgraph NETWORK["Zone réseau sécurisée"]
        TLS["HTTPS / TLS"]
        PROXY["Reverse Proxy"]
        FIREWALL["Pare-feu"]
    end

    subgraph BACKEND["Infrastructure Backend"]
        API["API REST"]
        AUTH["Authentification et autorisation"]
        SERVICES["Services métier"]
        WORKER["Workers"]
    end

    subgraph STORAGE["Zone de stockage"]
        PG[("PostgreSQL")]
        REDIS[("Redis")]
        MQ[("File de messages")]
        AUDIT[("Journaux d'audit")]
    end

    subgraph EXTERNAL["Services externes"]
        MAP["Fournisseur cartographique"]
        PUSH["Service notifications"]
    end

    DRIVER --> APP
    ADMIN --> TLS
    APP <--> TOKENS
    APP <--> SQLITE
    APP <--> QUEUE
    APP <-->|HTTPS / TLS| TLS
    TLS --> PROXY
    PROXY --> FIREWALL
    FIREWALL --> API
    API --> AUTH
    AUTH --> SERVICES
    SERVICES <--> PG
    SERVICES <--> REDIS
    SERVICES --> MQ
    SERVICES --> AUDIT
    MQ --> WORKER
    WORKER <--> PG
    SERVICES <-->|HTTPS| MAP
    WORKER <-->|HTTPS| PUSH
```

Mesures à appliquer : - chiffrement TLS pour les communications externes
; - authentification et autorisation côté serveur ; - validation des
entrées ; - protection des secrets ; - journalisation des opérations
administratives sensibles ; - isolation des données par installation ; -
idempotence des opérations de suppression ; - absence de coordonnées GPS
dans les notifications de confidentialité.

------------------------------------------------------------------------

# 10. Architecture technique proposée

## 10.1 Vue logique

Une architecture en couches est recommandée pour le backend :

1.  **Présentation** : API REST, contrôleurs, middleware et validation.
2.  **Application** : orchestration des cas d'utilisation.
3.  **Domaine** : entités, règles métier et services de domaine.
4.  **Infrastructure** : base de données, cache, files, cartographie,
    notifications et journaux.

Pour une première version, un **monolithe modulaire** peut limiter la
complexité opérationnelle tout en préservant une séparation claire des
domaines. L'extraction ultérieure de certains modules en services
indépendants pourra être envisagée selon la charge et les besoins.

## 10.2 Choix techniques non encore définitifs

  -----------------------------------------------------------------------
  Élément                 Proposition             Statut
  ----------------------- ----------------------- -----------------------
  Application mobile      React Native / Expo     À confirmer

  Stockage mobile         SQLite                  Proposition cohérente
                                                  avec le besoin hors
                                                  ligne

  Backend                 Framework et langage à  Ouvert
                          choisir                 

  Base serveur            PostgreSQL              Proposition

  Cache                   Redis                   Proposition

  File asynchrone         Broker à choisir        Ouvert

  Cartographie            Fournisseur à           Ouvert
                          sélectionner            

  Notifications           Service Push compatible À choisir
                          avec les plateformes    

  Hébergement             Infrastructure à        Ouvert
                          dimensionner            

  Authentification        Fournisseur à           Ouvert
  externe                 sélectionner si         
                          nécessaire              
  -----------------------------------------------------------------------

## 10.3 Exigences non fonctionnelles à prendre en compte

-   Disponibilité raisonnable des fonctions essentielles.
-   Résilience aux pertes de réseau et arrêts de l'application.
-   Protection des données personnelles et minimisation des données GPS.
-   Cohérence des opérations synchronisées.
-   Observabilité des API et workers.
-   Capacité à augmenter indépendamment la puissance de traitement API
    et workers.
-   Tests des transitions temporelles autour du délai de 24 heures.
-   Tests des changements d'horloge, redémarrages et reprises hors
    ligne.
-   Tests de suppression idempotente et de non-réémission des données
    supprimées.

------------------------------------------------------------------------

# 11. Points à valider et décisions ouvertes

## 11.1 Validation fonctionnelle

Les points suivants doivent être confrontés au référentiel complet RM-01
à RM-160 et RM-C01 à RM-C24 :

-   intitulés exacts et périmètre de chaque cas d'utilisation ;
-   droits du conducteur sur les données et historiques ;
-   seuils de validation et de confiance des incidents ;
-   critères de rapprochement de deux signalements ;
-   conditions de déclenchement et de présentation des recommandations ;
-   fonctions exactes de l'administration ;
-   catégories de notifications ;
-   règles de conservation de chaque catégorie de données.

## 11.2 Validation structurelle UML

Avant de considérer le modèle comme définitif :

1.  Vérifier les attributs et leurs types.
2.  Vérifier la visibilité et les signatures des méthodes.
3.  Vérifier les associations, navigabilités et multiplicités.
4.  Vérifier les compositions et agrégations.
5.  Distinguer clairement entités métier, services applicatifs et
    composants techniques.
6.  Vérifier la cohérence entre classes, séquences, activités et
    états-transitions.
7.  Vérifier les contraintes de suppression, de consentement et de
    restauration.
8.  Ajouter les diagrammes détaillés de cas d'utilisation et leurs
    descriptions textuelles.

## 11.3 Décisions techniques à prendre

-   Framework mobile définitif.
-   Langage et framework backend.
-   Fournisseur cartographique et conditions d'utilisation hors ligne.
-   Schéma de stockage des observations et agrégats.
-   Broker et mécanisme de traitement asynchrone.
-   Infrastructure d'hébergement et stratégie de sauvegarde.
-   Authentification des conducteurs et administrateurs.
-   Politique de conservation des données autres que les résumés locaux
    de 30 jours.

## 11.4 Ordre de travail recommandé pour finaliser la conception

  Étape   Livrable
  ------- ----------------------------------------------------------------
  1       Diagrammes détaillés de cas d'utilisation
  2       Validation des exigences et traçabilité RM → cas d'utilisation
  3       Diagrammes de classes consolidés et corrigés
  4       Vérification des séquences et activités
  5       Vérification des états-transitions
  6       Validation composants et déploiement
  7       Matrice de traçabilité exigences → diagrammes → tests
  8       Dossier de conception final

------------------------------------------------------------------------

## Conclusion

Cette conception fournit une vue d'ensemble du système de gestion du
trafic en temps réel, depuis les interactions des conducteurs jusqu'au
déploiement de l'application mobile et du backend.

Elle met particulièrement en évidence quatre contraintes structurantes :

1.  La navigation doit rester résiliente aux interruptions et aux pertes
    de réseau.
2.  Le GPS utilisé pour naviguer doit être distingué des observations
    collectées avec consentement pour les statistiques.
3.  Les signalements, incidents, recommandations et statistiques doivent
    être traités comme des domaines métier distincts.
4.  La suppression des données doit être persistante, idempotente et
    confirmée explicitement par le serveur.

**Ce document est une base de conception consolidée et évolutive. Il
doit être confronté au référentiel complet des exigences avant
validation définitive.**
