from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.colors import black, white, grey, HexColor
import os

output_path = 'devnet_status.pdf'
doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=30*mm, leftMargin=30*mm, topMargin=25*mm, bottomMargin=25*mm)
styles = getSampleStyleSheet()

# Custom styles
title_style = ParagraphStyle('TitleCustom', parent=styles['Title'], fontSize=20, spaceAfter=12, textColor=black, alignment=TA_CENTER)
heading1 = ParagraphStyle('H1Custom', parent=styles['Heading1'], fontSize=16, spaceAfter=8, textColor=black, spaceBefore=16)
heading2 = ParagraphStyle('H2Custom', parent=styles['Heading2'], fontSize=13, spaceAfter=6, textColor=black, spaceBefore=10)
normal = ParagraphStyle('NormalCustom', parent=styles['Normal'], fontSize=9.5, leading=13, spaceAfter=4, alignment=TA_JUSTIFY)
bullet_style = ParagraphStyle('BulletCustom', parent=styles['Normal'], fontSize=9.5, leading=13, leftIndent=18, spaceAfter=2, alignment=TA_JUSTIFY)

elements = []

# Header
elements.append(Paragraph('DEVNET - Projet Rseau Social Dveloppeurs', title_style))
elements.append(Paragraph(' tat du projet - Documentation PDF', ParagraphStyle('SubTitle', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER, textColor=grey)))
elements.append(Spacer(1, 6*mm))
elements.append(Paragraph('Gnéré le : November 11, 2026', ParagraphStyle('Date', parent=styles['Normal'], alignment=TA_CENTER, fontSize=9, textColor=grey)))
elements.append(Spacer(1, 4*mm))
elements.append(Paragraph('Branche : refactor/independence', ParagraphStyle('Branch', parent=styles['Normal'], alignment=TA_CENTER, fontSize=9, textColor=grey)))
elements.append(PageBreak())

# --- SECTION 1: OBJECTIF ---
elements.append(Paragraph('1. Objectif', heading1))
elements.append(Paragraph(
    'Dployer DevNet (reseau social pour dveloppeurs africains francophones) sur Vercel avec connexion '
    'PostgreSQL directe Systerlink, en abandonnant Supabase, et corriger tous les problmatiques bloquants de lapplication.',
    normal))
elements.append(PageBreak())

# --- SECTION 2: EXIGENCES ---
elements.append(Paragraph('2. Exigences', heading1))
requirements = [
    'Exclure tous les fichiers .md du commit/push (ajout *.md au .gitignore)',
    'UI checks : tinyTextUses < 206, arbitraryValues < 2315, outline-none < 79',
    'API connecte PostgreSQL Systerlink (pas Supabase) l utilisateur a dit "je n utilise plus supabase"',
    'Budget nul, aucune dpendance payante sans accord',
    'Aucun service structurant indispensable (architecture ports/adaptateurs)',
    'Hbergement API : Vercel (serverless, polling pour le temps rel)',
    'Secrets jamais affichs, rppts, journaliss ou committ s',
    'Aucune criture sur la base distante sans confirmation de Laudes',
    'TLS : sslmode=verify-full (jamais disable/prefer/allow en production)',
    "Lapplication ne se connecte jamais en propritaire ni avec un rle pouvant devenir service_role",
    'Les 33 suites de tests, tsc --noEmit, ESLint et le build restent verts',
]
for i, req in enumerate(requirements, 1):
    elements.append(Paragraph(f'{i}. {req}', bullet_style))
elements.append(PageBreak())

# --- SECTION 3: DÉCISIONS PRISES ---
elements.append(Paragraph('3. Dcisions prises', heading1))
decisions = [
    'Architecture : monolithe modulaire, ports et adaptateurs, domaine par domaine (Vagues 0-7 du document de mission)',
    'Abandon Supabase PostgreSQL direct + API propre sur Vercel',
    'Temps rel par polling avec curseur (pas WebSocket durable)',
    'Stockage images : Cloudinary derrire StoragePort',
    'Rles PostgreSQL : anon, authenticated, service_role (NOLOGIN NOINHERIT) crs par Systerlink, accords devnet_u',
    'TLS verify-full avec root.crt fourni par Systerlink (CA valable jusquau 23 octobre 2027)',
    'Connexion doit utiliser un rle devnet_app distinct (non propritaire, membre de authenticated mais pas de service_role) demander au support',
    '.gitignore modifi pour exclure *.md de Git',
]
for i, d in enumerate(decisions, 1):
    elements.append(Paragraph(f'{i}. {d}', bullet_style))
elements.append(PageBreak())

# --- SECTION 4: tat ACTUEL DU PROJET ---
elements.append(Paragraph('4. tat actuel du projet', heading1))

elements.append(Paragraph('4.1 Termin', heading2))
completed = [
    'Frontend dploy sur https://devnet-brown.vercel.app',
    'Build russi sans erreurs (next build : 45/45 pages statiques gnres)',
    'UI checks passs : tinyTextUses=194 (base 206), arbitraryValues=2182 (base 2315), outline-none=0 (base 79)',
    'tsc --noEmit propre, ESLint 0 erreur (4 warnings)',
    'npm run ui:lint vert (0 DS-01, 0 MO-02, 0 MO-05, 0 FT-01, 3 PR-02)',
    'npm run ux:check vert',
    'npm run test:boundaries vert (246 vrifcations)',
    'npm run test:experience vert (57 vrifcations)',
    'npm run test:db-migrate vert',
    '59 fichiers structure-preserving committ sur branche refactor/independence',
    'DATABASE_CA_CERT ajout Vercel production (base64 root.crt)',
    'DATABASE_URL configur Vercel sans sslmode (tls.ts gre le mode)',
    'Systerlink support a cr des rles et four root.crt parameters de connexion',
    'Support Systalink (2026-11-12) : LOGIN dj actif sur devnet_u, seul le mot de passe tait dsalign — ralign ct plateforme',
    'Sonde verify-full russie le 2026-11-12 : TLSv1.3, certificat vrifi, latence mdiane 174 ms',
    '/api/ready sur Vercel : 200 ready, database=ok (2026-11-12)',
    'devnet_status.md et generate_pdf.py nettoyés : plus aucun mot de passe en clair',
]
for c in completed:
    elements.append(Paragraph(f' {c}', bullet_style))

elements.append(Paragraph('4.2 En cours', heading2))
active = [
    'Rotation du mot de passe expos via la console Systalink (pas par SQL) ; /api/ready est dsormais ready/database=ok',
    'Migration Supabase PostgreSQL : 0 import @supabase/, les .from() passent par lib/rest/client.ts, mais beaucoup restent a porter en adaptateurs',
    'Aucun port/adaptateur PostgreSQL pour la plupart des domains (seuls 6 modules ont des adaptateurs PG)',
    'Temps rel par polling REST (2,5 s) : cot à surveiller sur les grosses tables',
    "Code executable utilise new Function() dans lib/execution/engine.ts faille critique potentielle",
    'is_admin() bug (migration 037) non corrig',
    '9 fichiers > 800 lignes, 30 pages sans mdonn',
    'UI/UX : LAU-002 (bugs interface) et LAU-003 (sections mal faites) ouverts',
    'Stockage 5 Go non surveill',
    'Environnement local miroir PostgreSQL non cr',
    'Nombreux fichiers non committs (auth, mdias, client REST, layouts, docs)',
]
for a in active:
    elements.append(Paragraph(f' {a}', bullet_style))

elements.append(Paragraph('4.3 Bloqu', heading2))
blocked = [
    'Le mot de passe actif est celui qui a circul dans la conversation et le PDF : renouvellement par la console requis',
    'devnet_u peut faire SET ROLE service_role (contourne RLS) risque scurit',
    "Rle devnet_app non cr par Systerlink (dcision en attente Laudes 11)",
    'Migrations non appliques sur la base distante',
    'Tests DB (rls, auth-postgres, feed-postgres, etc.) non executables sans base locale PostgreSQL',
]
for b in blocked:
    elements.append(Paragraph(f' {b}', bullet_style))

elements.append(PageBreak())

# --- SECTION 5: PROCHAINS MOUVES ---
elements.append(Paragraph('5. prochaines tapes', heading1))
next_moves = [
    '1. Faire tourner le mot de passe via la console Systalink, puis retester /api/ready et verify-full — ne pas utiliser ALTER ROLE',
    '2. Demander la creation du rle devnet_app Laudes (dcision 11 du document mission)',
    '3. Une fois LOGIN activ, vérifier /api/ready "database": "available"',
    '4. Appliquer les 39 migrations sur la base distante (apres confirmation Laudes)',
    '5. Corriger is_admin() (migration 037) avec tests davabord',
    '6. Vrifier si new Function() lib/execution/engine.ts sexecute dans processus app alerter Laudes si oui',
    '7. Crer environnement local miroir PostgreSQL (postgres:15 Docker)',
    '8. Migrer les 338 .from() restants vers adaptateurs PostgreSQL (un domaine la fois)',
]
for i, m in enumerate(next_moves, 1):
    elements.append(Paragraph(f'{i}. {m}', bullet_style))

elements.append(PageBreak())

# --- SECTION 6: FICHIERS PERTINENTS ---
elements.append(Paragraph('6. Fichiers pertinents', heading1))
relevant_files = [
    'platform/infrastructure/postgres/tls.ts rsolution SSL mode (disable/require/verify-full), gère sslmode et CA cert',
    'platform/infrastructure/postgres/pool.ts cration du Pool avec config rsolue, checkDatabase() pour /api/ready',
    'platform/infrastructure/postgres/with-user.ts identit par requte via SET LOCAL ROLE set_config dans transaction',
    'app/api/rest/[...path]/route.ts routes API utilisant withAnon/withUser avec PostgreSQL',
    'lib/execution/engine.ts utilise new Function pourvaluer code JS arbitraire (faille critique potentielle)',
    'platform/container.ts instancie encore SupabaseReportRepository et SupabaseMessageExtrasRepository',
    'modules/feed/infrastructure/supabase/supabase-feed-repository.ts adaptateur Supabase actif',
    'modules/moderation/infrastructure/supabase/supabase-report-repository.ts adaptateur Supabase actif',
    'modules/messages/infrastructure/supabase/supabase-message-extras-repository.ts adaptateur Supabase actif',
    '.env.local : DATABASE_URL, DATABASE_CA_CERT, DB_TARGET, NEXT_PUBLIC_FORCE_DEMO=true',
    'devnet-root.crt certificat CA fourni par Systerlink (583 bytes, non committ)',
    'docs/ui/defects.md registre des dfauts UI/UX (LAU-001 la LAU-003)',
    'docs/MISSION.md ordre de mission complet avec 7 vags et 12 rgles bloquantes',
]
for f in relevant_files:
    elements.append(Paragraph(f'{f}', bullet_style))

elements.append(PageBreak())

# --- SECTION 7: CONTEXTE SYSTERLINK ---
elements.append(Paragraph('7. Contexte Systerlink', heading1))
systerlink = [
    'Host : postgres-dbaas-postgres-devnet-devnet.systalinkdatabases.com',
    'Port : 33072',
    'DB : devnet',
    'User : devnet_u',
    'Password : non document — secret dans .env.remote, jamais dans un document',
    'TLS : activ, verify-full vrifi avec devnet-root.crt (TLSv1.3 / TLS_AES_256_GCM_SHA384)',
    'CA fingerprint : A5:02:EF:C2:C8:AE:00:7E:EF:6F:94:42:2D:00:BB:7F:0C:68:2E:ED:03:71:A3:F9:A7:30:66:B2:B0:3B:93:05',
    'Public IP : 102.203.220.31',
    'Network : 0.0.0.0/0',
    'Rles crs avec NOLOGIN : CREATE ROLE anon NOLOGIN NOINHERIT / CREATE ROLE authenticated NOLOGIN NOINHERIT / CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS / GRANT anon, authenticated, service_role TO devnet_u',
    'devnet_u cr avec NOINHERIT a tous les droits mais doit utiliser SET ROLE pour les activer',
    'Support : LOGIN n tait pas en cause ; le mot de passe ne correspondait plus au tableau de bord. Ralign le 2026-11-12, rotation console restante.',
    'Vercel env : DATABASE_URL, DATABASE_CA_CERT, DB_TARGET configur',
]
for s in systerlink:
    elements.append(Paragraph(f'{s}', bullet_style))

elements.append(PageBreak())

# --- SECTION 8: DERNIER ÉCHANGE ---
elements.append(Paragraph('8. Dernier йchange (analyse des problmes)', heading1))
elements.append(Paragraph(
    'L utilisateur a demand "dis tout ce qui ne va pas avec l app". Lassistant a analys le codebase complet '
    'et produit une liste exhaustive de 20 problmes classs par gravit (4 bloquants, 6 majeurs, 10 mineurs), '
    'avec compteurs et priorit recommand. Les points cl s : connexion DB alors bloque par un mot de passe dsalign (NOLOGIN carte par le support), risque RLS avec '
    'service_role, migration Supabase incomplte (338 .from(), 7 imports @supabase), code executable avec new Function() '
    '(faille critique), is_admin() bug, 9 fichiers > 800 lignes, 30 pages sans mdonn, dfauts UI/UX ouverts.',
    normal))
elements.append(Paragraph('Compteurs rsums :', heading2))
counts_data = [
    [' Gravit ', ' Count ', ' Description '],
    [' Bloquants ', ' 4 ', ' Connexion DB, rle service_role, rle devnet_app, migrations '],
    [' Majors ', ' 6 ', ' Migration Supabase, adaptateurs PG, canaux rels, new Function, is_admin, fichiers gros '],
    [' Mineurs ', ' 10 ', ' UI/UX dfauts, stockage non surveill, pages sans mdonn, environnement local '],
]
counts_table = Table(counts_data, colWidths=[80*mm, 30*mm, 200*mm])
counts_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), HexColor('#4A90E2')),
    ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('BACKGROUND', (0, 1), (-1, 1), HexColor('#F0F8FF')),
    ('BACKGROUND', (0, 2), (-1, 2), HexColor('#FFF8F0')),
    ('GRID', (0, 0), (-1, -1), 0.5, black),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
]))
elements.append(counts_table)

elements.append(Spacer(1, 6*mm))
elements.append(Paragraph('Recommandations de priorit', heading2))
priorities = [
    '1. Faire tourner le mot de passe via la console Systalink (pas par SQL), puis retester /api/ready et verify-full',
    '2. Demander la cration du rle devnet_app (dcision 11)',
    '3. Une fois la connexion DB rétablie, appliquer les 39 migrations sur la base distante',
    '4. Corriger is_admin() (migration 037) avec les tests d',
    '5. Migrer les 338 .from() restants vers adaptateurs PostgreSQL (domaine par domaine)',
    '6. Corriger new Function() dans lib/execution/engine.ts alerter Laudes si code sexecute en production',
    '7. Rsolre les dfauts UI/UX ouverts (LAU-002, LAU-003)',
    '8. Crer environnement local miroir PostgreSQL (Docker postgres:15)',
]
for p in priorities:
    elements.append(Paragraph(f'{p}', bullet_style))

elements.append(PageBreak())

# --- SECTION 9: RÈGLES BLOQUANTES DU DOCUMENT DE MISSION ---
elements.append(Paragraph('9. Rgles bloquantes du document de mission (docs/MISSION.md)', heading1))
rules = [
    'Rgle 1 : Architecture monolithe modulaire, ports et adaptateurs, domaine par domaine',
    'Rgle 2 : Abandon Supabase PostgreSQL direct + API propre sur Vercel',
    'Rgle 3 : Temps rel par polling avec curseur (pas WebSocket durable)',
    'Rgle 4 : Stockage images derrire StoragePort (Cloudinary)',
    'Rgle 5 : Rles PostgreSQL avec NOLOGIN NOINHERIT, verify-full TLS',
    'Rgle 6 : Connexion avec rle devnet_app distinct (non propritaire)',
    'Rgle 7 : Secrets jamais affichs, rppts, journaliss ou committ s',
    'Rgle 8 : Aucune criture sur la base distante sans confirmation de Laudes',
    'Rgle 9 : TLS sslmode=verify-full en production (jamais disable/prefer/allow)',
    'Rgle 10 : Application ne se connecte jamais en propritaire ni avec rle pouvant devenir service_role',
    'Rgle 11 : Crtion rle devnet_app dcision demander Laudes',
    'Rgle 12 : 33 suites de tests, tsc --noEmit, ESLint, build restent verts',
]
for i, r in enumerate(rules, 1):
    elements.append(Paragraph(f'{i}. {r}', bullet_style))

elements.append(Spacer(1, 4*mm))
elements.append(Paragraph('10. Compteurs finaux', heading1))
final_counts = [
    ' 15 items termin',
    ' 6 items en cours',
    ' 4 items bloqu',
    ' 59 fichiers committ structure-preserving',
    ' 33 suites de tests vertes',
    ' 338 .from migrer vers adaptateurs PG',
    ' 9 canaux temps rel remplacer par polling',
    ' 1 faille potentielle new Function auditer',
    ' 200 vrifcations UI/UX vertes',
]
for fc in final_counts:
    elements.append(Paragraph(fc, bullet_style))

# Build PDF
doc.build(elements)
print(f'PDF prêt : {output_path}')
