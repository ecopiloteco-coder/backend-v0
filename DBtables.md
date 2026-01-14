// Schema: public

Table public.articles {
  ID integer [pk, not null, default: `nextval('articles_id_seq'::regclass)`]
  Date date
  nom_article varchar
  Unite varchar
  Type varchar
  Expertise varchar
  Fourniture varchar
  Cadence varchar
  Accessoires varchar
  Pertes varchar
  PU varchar
  Prix_Cible varchar
  Prix_estime varchar
  Prix_consulte varchar
  Rabais varchar
  Commentaires varchar
  User integer
  Indice_de_confiance integer
  files text
  fournisseur integer
  id_niv_6 integer
}

Table public.articles_supprime {
  ID integer [pk, not null, default: `nextval('articles_id_seq'::regclass)`]
  Date date
  nom_article varchar
  Unite varchar
  Type varchar
  Expertise varchar
  Fourniture varchar
  Cadence varchar
  Accessoires varchar
  Pertes varchar
  PU varchar
  Prix_Cible varchar
  Prix_estime varchar
  Prix_consulte varchar
  Rabais varchar
  Commentaires varchar
  User integer
  Indice_de_confiance integer
  files text
  deleted_by varchar
  fournisseur integer
  id_niv_6 integer
}

Table public.bloc {
  id integer [pk, not null]
  nom_bloc varchar
  unite varchar
  quantite integer
  pu real
  pt real
  designation varchar
  ouvrage integer
}

Table public.client {
  id integer [pk, not null]
  nom_client varchar
  marge_brut real
  marge_net real
  agence varchar
  responsable varchar
  effectif_chantier text
}

Table public.events {
  id_event integer [pk, not null]
  action varchar
  created_at timestamp
  metadata json
  user integer
  article integer
  bloc integer
  ouvrage integer
  bloc_nom_anc varchar
  ouvrage_nom_anc varchar
  projet integer
  lot integer
}

Table public.fournisseur {
  id_fournisseur integer [pk, not null]
  nom_fournisseur varchar
  type varchar
  categorie varchar
  adresse varchar
  telephone varchar
  email varchar
  URL text
}

Table public.niveau_1 {
  id_niveau_1 integer [pk, not null]
  niveau_1 varchar
}

Table public.niveau_2 {
  id_niveau_2 integer [pk, not null]
  niveau_2 varchar
  id_niv_1 integer
}

Table public.niveau_3 {
  id_niveau_3 integer [pk, not null]
  niveau_3 varchar
  id_niv_2 integer
}

Table public.niveau_4 {
  id_niveau_4 integer [pk, not null]
  niveau_4 varchar
  id_niv_3 integer
}

Table public.niveau_5 {
  id_niveau_5 integer [pk, not null]
  niveau_5 varchar
  id_niv_4 integer
  id_niv_3 integer
}

Table public.niveau_6 {
  id_niveau_6 integer [pk, not null]
  niveau_6 varchar
  id_niv_5 integer
  id_niv_4 integer
  id_niv_3 integer
}

Table public.notifs {
  id_notif integer [pk, not null]
  event integer
  user_recep integer
  is_read boolean
  created_at timestamp
  read_at timestamp
  nbr integer
}

Table public.ouvrage {
  id integer [pk, not null]
  nom_ouvrage varchar
  prix_total real
  designation varchar
  projet_lot integer
}

Table public.pending_articles {
  ID integer [pk, not null, default: `nextval('"pending_articles_ID_seq"'::regclass)`]
  Date date [not null]
  nom_article varchar [not null]
  Unite varchar [not null]
  Type varchar [not null]
  Expertise varchar [not null]
  Fourniture numeric [default: 0.00]
  Cadence numeric [default: 0.00]
  Accessoires numeric [default: 0.00]
  Pertes varchar [default: `'0%'::character varying`]
  PU varchar [not null]
  Prix_Cible numeric [default: 0.00]
  Prix_estime numeric [default: 0.00]
  Prix_consulte numeric [default: 0.00]
  Rabais varchar [default: `'0%'::character varying`]
  Commentaires text [default: `''::text`]
  created_by integer [not null]
  status varchar [default: `'En attente'::character varying`]
  submitted_at timestamp [default: `CURRENT_TIMESTAMP`]
  updated_at timestamp
  reviewed_by varchar
  reviewed_at timestamp
  Indice_de_confiance integer [default: 3]
  files text
  rejected_by varchar
  fournisseur integer
  id_niv_6 integer
  approved_article_id integer
}

Table public.projet_article {
  id integer [pk, not null]
  article integer
  quantite integer
  prix_total_ht real
  tva real
  total_ttc real
  localisation varchar
  description varchar
  nouv_prix real
  designation_article varchar
  structure integer
}

Table public.projet_equipe {
  id integer [pk, not null]
  equipe integer
  projet integer
}

Table public.projet_lot {
  id_projet_lot integer [pk, not null]
  id_projet integer [not null]
  id_lot integer [not null]
  designation_lot varchar
  prix_total real
  prix_vente real
}

Table public.projets {
  id integer [pk, not null]
  Nom_Projet varchar
  Date_Limite date
  Ajouté_par integer
  Description varchar
  created_at timestamp
  adresse varchar
  Cout real
  Date_Debut date
  client integer
  file text
  prix_vente real
  etat varchar
}

Table public.structure {
  id_structure integer [pk, not null]
  ouvrage integer
  bloc integer
  action varchar
}

Table public.users {
  nom_utilisateur varchar [not null]
  email varchar [not null]
  titre_poste varchar [not null]
  mot_de_passe text [not null]
  date_creation_compte timestamp [not null, default: `CURRENT_TIMESTAMP`]
  is_admin boolean [default: false]
  id integer [pk, not null, default: `nextval('users_id_seq'::regclass)`]
}

/* Relationships (FKs) - short form Ref syntax */
Ref: public.articles.User > public.users.id
Ref: public.articles.fournisseur > public.fournisseur.id_fournisseur
Ref: public.articles.id_niv_6 > public.niveau_6.id_niveau_6

Ref: public.articles_supprime.fournisseur > public.fournisseur.id_fournisseur
Ref: public.articles_supprime.User > public.users.id
Ref: public.articles_supprime.id_niv_6 > public.niveau_6.id_niveau_6

Ref: public.bloc.ouvrage > public.ouvrage.id

Ref: public.events.article > public.articles.ID
Ref: public.events.bloc > public.bloc.id
Ref: public.events.lot > public.niveau_2.id_niveau_2
Ref: public.events.ouvrage > public.ouvrage.id
Ref: public.events.projet > public.projets.id
Ref: public.events.user > public.users.id

Ref: public.niveau_2.id_niv_1 > public.niveau_1.id_niveau_1
Ref: public.niveau_3.id_niv_2 > public.niveau_2.id_niveau_2
Ref: public.niveau_4.id_niv_3 > public.niveau_3.id_niveau_3
Ref: public.niveau_5.id_niv_3 > public.niveau_3.id_niveau_3
Ref: public.niveau_5.id_niv_4 > public.niveau_4.id_niveau_4
Ref: public.niveau_6.id_niv_3 > public.niveau_3.id_niveau_3
Ref: public.niveau_6.id_niv_4 > public.niveau_4.id_niveau_4
Ref: public.niveau_6.id_niv_5 > public.niveau_5.id_niveau_5

Ref: public.notifs.event > public.events.id_event
Ref: public.notifs.user_recep > public.users.id

Ref: public.ouvrage.projet_lot > public.projet_lot.id_projet_lot

Ref: public.pending_articles.created_by > public.users.id
Ref: public.pending_articles.approved_article_id > public.articles.ID
Ref: public.pending_articles.fournisseur > public.fournisseur.id_fournisseur
Ref: public.pending_articles.id_niv_6 > public.niveau_6.id_niveau_6

Ref: public.projet_article.article > public.articles.ID
Ref: public.projet_article.structure > public.structure.id_structure

Ref: public.projet_equipe.projet > public.projets.id
Ref: public.projet_equipe.equipe > public.users.id

Ref: public.projet_lot.id_lot > public.niveau_2.id_niveau_2
Ref: public.projet_lot.id_projet > public.projets.id

Ref: public.projets.client > public.client.id
Ref: public.projets.Ajouté_par > public.users.id

Ref: public.structure.bloc > public.bloc.id
Ref: public.structure.ouvrage > public.ouvrage.id
