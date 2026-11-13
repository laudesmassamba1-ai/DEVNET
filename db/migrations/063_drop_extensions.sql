-- 063 — Retrait du registre d'extensions.
--
-- La place de marché (migration 029) a été retirée de l'application : plus
-- d'onglet, plus de section, plus de manifeste chargé par l'IDE. Laisser les
-- tables en place aurait gardé un catalogue que plus rien ne lit ni ne
-- protège — une surface d'attaque gratuite, et des politiques RLS à
-- maintenir pour rien.
--
-- `drop ... if exists` rend la migration rejouable sur une base qui n'aurait
-- jamais connu la 029 (installation neuve), sans échouer.
drop table if exists public.extension_installs cascade;
drop table if exists public.extensions cascade;
drop function if exists public.sync_extension_installs() cascade;
