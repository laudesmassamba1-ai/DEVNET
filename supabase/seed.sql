SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict EimhDAsiqDMRKp0pjNLz3jCuYTrOgl3kcbQUkiGvPQTe8nsQjaFI5EO4UfKNcLz

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."audit_log_entries" ("instance_id", "id", "payload", "created_at", "ip_address") VALUES
	('00000000-0000-0000-0000-000000000000', '0378d33b-9e61-4263-b966-0c83a04ad374', '{"action":"user_signedup","actor_id":"99ee9d99-9277-4f20-9799-3b8d2bbe848b","actor_username":"test@devnet.local","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2026-10-13 10:41:05.001233+00', ''),
	('00000000-0000-0000-0000-000000000000', '0a9332d6-573a-4cb4-b5f5-dfed1330f994', '{"action":"login","actor_id":"99ee9d99-9277-4f20-9799-3b8d2bbe848b","actor_username":"test@devnet.local","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2026-10-13 10:41:05.041504+00', ''),
	('00000000-0000-0000-0000-000000000000', '14457ca0-2e00-4dcc-b1da-90eb6135bc85', '{"action":"login","actor_id":"99ee9d99-9277-4f20-9799-3b8d2bbe848b","actor_username":"test@devnet.local","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2026-10-13 10:44:35.950576+00', '');


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', '99ee9d99-9277-4f20-9799-3b8d2bbe848b', 'authenticated', 'authenticated', 'test@devnet.local', '$2a$10$puwxxLCrwWVumEpk8BrKVe00GMiRXPqRy7L4jJvy87D5Z5L6.zbLq', '2026-10-13 10:41:05.010246+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-10-13 10:44:35.95357+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "99ee9d99-9277-4f20-9799-3b8d2bbe848b", "email": "test@devnet.local", "email_verified": true, "phone_verified": false}', NULL, '2026-10-13 10:41:04.944762+00', '2026-10-13 10:44:35.960445+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('99ee9d99-9277-4f20-9799-3b8d2bbe848b', '99ee9d99-9277-4f20-9799-3b8d2bbe848b', '{"sub": "99ee9d99-9277-4f20-9799-3b8d2bbe848b", "email": "test@devnet.local", "email_verified": false, "phone_verified": false}', 'email', '2026-10-13 10:41:04.983227+00', '2026-10-13 10:41:04.983317+00', '2026-10-13 10:41:04.983317+00', '304130e5-9b56-4b46-9094-c254ba8d0db6');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") VALUES
	('2ed3046a-e493-4c04-9674-871a1a67bc99', '99ee9d99-9277-4f20-9799-3b8d2bbe848b', '2026-10-13 10:41:05.063467+00', '2026-10-13 10:41:05.063467+00', NULL, 'aal1', NULL, NULL, 'curl/8.5.0', '172.18.0.1', NULL, NULL, NULL, NULL, NULL),
	('54a07789-b430-42ab-a7b7-a3598520d3bf', '99ee9d99-9277-4f20-9799-3b8d2bbe848b', '2026-10-13 10:44:35.953673+00', '2026-10-13 10:44:35.953673+00', NULL, 'aal1', NULL, NULL, 'curl/8.5.0', '172.18.0.1', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") VALUES
	('2ed3046a-e493-4c04-9674-871a1a67bc99', '2026-10-13 10:41:05.080453+00', '2026-10-13 10:41:05.080453+00', 'password', '3e48390f-d4d5-4a4b-9e14-a8a097163d7b'),
	('54a07789-b430-42ab-a7b7-a3598520d3bf', '2026-10-13 10:44:35.962398+00', '2026-10-13 10:44:35.962398+00', 'password', '55d7da7d-f7ec-438a-9069-fd902516d7f7');


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") VALUES
	('00000000-0000-0000-0000-000000000000', 1, 'nmumbimpt5sj', '99ee9d99-9277-4f20-9799-3b8d2bbe848b', false, '2026-10-13 10:41:05.074165+00', '2026-10-13 10:41:05.074165+00', NULL, '2ed3046a-e493-4c04-9674-871a1a67bc99'),
	('00000000-0000-0000-0000-000000000000', 2, 'glgagxdfmksq', '99ee9d99-9277-4f20-9799-3b8d2bbe848b', false, '2026-10-13 10:44:35.957404+00', '2026-10-13 10:44:35.957404+00', NULL, '54a07789-b430-42ab-a7b7-a3598520d3bf');


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."users" ("id", "prenom", "pseudo", "email", "filiere", "niveau", "langages", "avatar_color", "bio", "followers", "following", "created_at", "account_type", "verified", "ville", "pays", "links") VALUES
	('99ee9d99-9277-4f20-9799-3b8d2bbe848b', '', 'test', 'test@devnet.local', '', '', '{}', 'av-orange', '', 0, 0, '2026-10-13 10:41:04.944211+00', 'student', false, '', '', '[]');


--
-- Comptes d'administration — migration 037.
--
-- Cinq comptes d'équipe. Même empreinte que `test@devnet.local`, donc
-- même mot de passe : `password123`. Ils portent `is_admin`, `verified`
-- et `verification_status = 'acceptee'` — le cachet **de base**, celui de
-- l'équipe, jamais une variante de palier : c'est à ça qu'on les
-- reconnaît sur un profil.
--
-- Le déclencheur `users_guard_account_roles` est neutre ici :
-- `session_replication_role = replica` (en tête de fichier) a déjà
-- désactivé les déclencheurs, et de toute façon `auth.uid()` est nul.
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'nadia_admin@devnet.africa', '$2a$10$puwxxLCrwWVumEpk8BrKVe00GMiRXPqRy7L4jJvy87D5Z5L6.zbLq', '2026-10-13 10:41:05.010246+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-10-13 10:41:05.010246+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "a1000000-0000-4000-8000-000000000001", "email": "nadia_admin@devnet.africa", "email_verified": true, "phone_verified": false}', NULL, '2026-10-13 10:41:04.944762+00', '2026-10-13 10:41:05.010246+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'elom_admin@devnet.africa', '$2a$10$puwxxLCrwWVumEpk8BrKVe00GMiRXPqRy7L4jJvy87D5Z5L6.zbLq', '2026-10-13 10:41:05.010246+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-10-13 10:41:05.010246+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "a1000000-0000-4000-8000-000000000002", "email": "elom_admin@devnet.africa", "email_verified": true, "phone_verified": false}', NULL, '2026-10-13 10:41:04.944762+00', '2026-10-13 10:41:05.010246+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'sadio_admin@devnet.africa', '$2a$10$puwxxLCrwWVumEpk8BrKVe00GMiRXPqRy7L4jJvy87D5Z5L6.zbLq', '2026-10-13 10:41:05.010246+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-10-13 10:41:05.010246+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "a1000000-0000-4000-8000-000000000003", "email": "sadio_admin@devnet.africa", "email_verified": true, "phone_verified": false}', NULL, '2026-10-13 10:41:04.944762+00', '2026-10-13 10:41:05.010246+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'njeri_admin@devnet.africa', '$2a$10$puwxxLCrwWVumEpk8BrKVe00GMiRXPqRy7L4jJvy87D5Z5L6.zbLq', '2026-10-13 10:41:05.010246+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-10-13 10:41:05.010246+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "a1000000-0000-4000-8000-000000000004", "email": "njeri_admin@devnet.africa", "email_verified": true, "phone_verified": false}', NULL, '2026-10-13 10:41:04.944762+00', '2026-10-13 10:41:05.010246+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'tendai_admin@devnet.africa', '$2a$10$puwxxLCrwWVumEpk8BrKVe00GMiRXPqRy7L4jJvy87D5Z5L6.zbLq', '2026-10-13 10:41:05.010246+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-10-13 10:41:05.010246+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "a1000000-0000-4000-8000-000000000005", "email": "tendai_admin@devnet.africa", "email_verified": true, "phone_verified": false}', NULL, '2026-10-13 10:41:04.944762+00', '2026-10-13 10:41:05.010246+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '{"sub": "a1000000-0000-4000-8000-000000000001", "email": "nadia_admin@devnet.africa", "email_verified": false, "phone_verified": false}', 'email', '2026-10-13 10:41:04.983227+00', '2026-10-13 10:41:04.983317+00', '2026-10-13 10:41:04.983317+00', 'b1000000-0000-4000-8000-000000000001'),
	('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', '{"sub": "a1000000-0000-4000-8000-000000000002", "email": "elom_admin@devnet.africa", "email_verified": false, "phone_verified": false}', 'email', '2026-10-13 10:41:04.983227+00', '2026-10-13 10:41:04.983317+00', '2026-10-13 10:41:04.983317+00', 'b1000000-0000-4000-8000-000000000002'),
	('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '{"sub": "a1000000-0000-4000-8000-000000000003", "email": "sadio_admin@devnet.africa", "email_verified": false, "phone_verified": false}', 'email', '2026-10-13 10:41:04.983227+00', '2026-10-13 10:41:04.983317+00', '2026-10-13 10:41:04.983317+00', 'b1000000-0000-4000-8000-000000000003'),
	('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', '{"sub": "a1000000-0000-4000-8000-000000000004", "email": "njeri_admin@devnet.africa", "email_verified": false, "phone_verified": false}', 'email', '2026-10-13 10:41:04.983227+00', '2026-10-13 10:41:04.983317+00', '2026-10-13 10:41:04.983317+00', 'b1000000-0000-4000-8000-000000000004'),
	('a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', '{"sub": "a1000000-0000-4000-8000-000000000005", "email": "tendai_admin@devnet.africa", "email_verified": false, "phone_verified": false}', 'email', '2026-10-13 10:41:04.983227+00', '2026-10-13 10:41:04.983317+00', '2026-10-13 10:41:04.983317+00', 'b1000000-0000-4000-8000-000000000005');

INSERT INTO "public"."users" ("id", "prenom", "pseudo", "email", "filiere", "niveau", "langages", "avatar_color", "bio", "followers", "following", "created_at", "account_type", "verified", "ville", "pays", "links", "is_admin", "verification_status") VALUES
	('a1000000-0000-4000-8000-000000000001', 'Nadia', 'nadia_admin', 'nadia_admin@devnet.africa', 'Génie Logiciel', 'M2', '{Go,Python}', 'av-violet', 'Administration DevNet. Je traite les demandes de vérification.', 51, 42, '2026-10-13 10:41:04.944211+00', 'professional', true, 'Lomé', 'Togo', '[]', true, 'acceptee'),
	('a1000000-0000-4000-8000-000000000002', 'Elom', 'elom_admin', 'elom_admin@devnet.africa', 'Cybersécurité', 'M1', '{Python,Rust}', 'av-sage', 'Administration DevNet. Comptes et communautés.', 51, 42, '2026-10-13 10:41:04.944211+00', 'professional', true, 'Cotonou', 'Bénin', '[]', true, 'acceptee'),
	('a1000000-0000-4000-8000-000000000003', 'Sadio', 'sadio_admin', 'sadio_admin@devnet.africa', 'Réseaux & Télécoms', 'Doctorat', '{Python,Go,SQL}', 'av-orange', 'Administration DevNet. Infrastructure et intégrités.', 51, 42, '2026-10-13 10:41:04.944211+00', 'professional', true, 'Dakar', 'Sénégal', '[]', true, 'acceptee'),
	('a1000000-0000-4000-8000-000000000004', 'Njeri', 'njeri_admin', 'njeri_admin@devnet.africa', 'Intelligence Artificielle', 'M2', '{Python,TypeScript}', 'av-pink', 'Administration DevNet. Modération du fil et du code.', 51, 42, '2026-10-13 10:41:04.944211+00', 'professional', true, 'Nairobi', 'Kenya', '[]', true, 'acceptee'),
	('a1000000-0000-4000-8000-000000000005', 'Tendai', 'tendai_admin', 'tendai_admin@devnet.africa', 'Génie Logiciel', 'L3', '{TypeScript,SQL}', 'av-lime', 'Administration DevNet. Fidèles et incidents.', 51, 42, '2026-10-13 10:41:04.944211+00', 'professional', true, 'Harare', 'Zimbabwe', '[]', true, 'acceptee');


--
-- Data for Name: communities; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: posts; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: bookmarks; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: groups; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: channels; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: channel_members; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: comments; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: community_members; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: conversation_members; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: direct_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: extensions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: extension_installs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: follows; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."projects" ("id", "group_id", "created_by", "name", "slug", "description", "emoji", "language", "visibility", "default_branch", "created_at", "stage", "seeking", "demand_languages", "demand_roles", "forked_from") VALUES
	('0a820db9-b932-40fb-a33e-2fa6af58e57f', NULL, NULL, 'Test Direct', 'test-direct', 'Direct insert', 'package', '', 'group', 'main', '2026-10-13 10:45:24.101902+00', 'idea', false, '{}', '{}', NULL);


--
-- Data for Name: git_commit_files; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: git_commits; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: git_files; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: git_refs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: github_connections; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: group_members; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: group_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: issues; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: issue_comments; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: message_pins; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: message_reactions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: post_likes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: post_projects; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_applications; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_forks; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_links; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_members; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_pages; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_ratings; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: project_tasks; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: proofs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: pull_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: reactions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: reports; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: reposts; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: review_corrections; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: snippets; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: stories; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: iceberg_namespaces; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: iceberg_tables; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: hooks; Type: TABLE DATA; Schema: supabase_functions; Owner: supabase_functions_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 2, true);


--
-- Name: hooks_id_seq; Type: SEQUENCE SET; Schema: supabase_functions; Owner: supabase_functions_admin
--

SELECT pg_catalog.setval('"supabase_functions"."hooks_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict EimhDAsiqDMRKp0pjNLz3jCuYTrOgl3kcbQUkiGvPQTe8nsQjaFI5EO4UfKNcLz

RESET ALL;
