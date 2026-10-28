create index if not exists idx_canaux_createur on public.canaux (createur_id);
create index if not exists idx_commentaires_parent on public.commentaires (parent_id);
create index if not exists idx_demandes_verification_traite_par on public.demandes_verification (traite_par);
create index if not exists idx_demandes_verification_statut_cree on public.demandes_verification (statut, cree_le);
create index if not exists idx_groupes_createur on public.groupes (createur_id);
create index if not exists idx_messages_canal_auteur on public.messages_canal (auteur_id);
create index if not exists idx_messages_prives_expediteur on public.messages_prives (expediteur_id);
create index if not exists idx_notifications_acteur on public.notifications (acteur_id);
create index if not exists idx_notifications_commentaire on public.notifications (commentaire_id);
create index if not exists idx_notifications_conversation on public.notifications (conversation_id);
create index if not exists idx_notifications_publication on public.notifications (publication_id);
create index if not exists idx_reactions_messages_utilisateur on public.reactions_messages (utilisateur_id);
create index if not exists idx_signalements_publication on public.signalements (publication_id);
create index if not exists idx_signalements_signaleur on public.signalements (signaleur_id);
create index if not exists idx_signets_publication on public.signets (publication_id);
create index if not exists idx_stories_expire on public.stories (expire_le);
create index if not exists idx_utilisateurs_badges_badge on public.utilisateurs_badges (badge_id);
create index if not exists idx_utilisateurs_cree on public.utilisateurs (cree_le);
create index if not exists idx_utilisateurs_succes_succes on public.utilisateurs_succes (succes_id);

do $$ begin
  alter table public.canaux add constraint chk_canaux_nom_non_vide check (nom <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.commentaires add constraint chk_commentaires_contenu_non_vide check (contenu <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.groupes add constraint chk_groupes_nom_non_vide check (nom <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.messages_canal add constraint chk_messages_canal_contenu_non_vide check (contenu <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.messages_prives add constraint chk_messages_prives_contenu_non_vide check (contenu <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.publications add constraint chk_publications_contenu_non_vide check (contenu <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.reactions add constraint chk_reactions_type_non_vide check (type <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.reactions_messages add constraint chk_reactions_messages_emoji_non_vide check (emoji <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.signalements add constraint chk_signalements_motif_non_vide check (motif <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.stories add constraint chk_stories_contenu_non_vide check (contenu <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.stories add constraint chk_stories_expiration_apres_creation check (expire_le > cree_le);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.utilisateurs add constraint chk_utilisateurs_nom_affiche_non_vide check (nom_affiche <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.utilisateurs add constraint chk_utilisateurs_pseudo_non_vide check (pseudo::text <> '');
exception when duplicate_object then null; end $$;

create or replace function public.tg_publications_modifie_le()
returns trigger
language plpgsql
as $$
begin
  new.modifie_le = now();
  return new;
end $$;

drop trigger if exists trg_publications_modifie_le on public.publications;
create trigger trg_publications_modifie_le
before update on public.publications
for each row
execute function public.tg_publications_modifie_le();

create or replace function public.tg_conversations_mis_a_jour_le()
returns trigger
language plpgsql
as $$
begin
  update public.conversations set mis_a_jour_le = now() where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists trg_messages_prives_mis_a_jour_le on public.messages_prives;
create trigger trg_messages_prives_mis_a_jour_le
after insert on public.messages_prives
for each row
execute function public.tg_conversations_mis_a_jour_le();

create or replace function public.tg_utilisateurs_succes_mis_a_jour_le()
returns trigger
language plpgsql
as $$
begin
  new.mis_a_jour_le = now();
  return new;
end $$;

drop trigger if exists trg_utilisateurs_succes_mis_a_jour_le on public.utilisateurs_succes;
create trigger trg_utilisateurs_succes_mis_a_jour_le
before update on public.utilisateurs_succes
for each row
execute function public.tg_utilisateurs_succes_mis_a_jour_le();
