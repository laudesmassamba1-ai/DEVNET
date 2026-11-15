# Bonjour DevNet

Plugin de référence du SDK. Il ne demande **aucune capacité** : il se contente
d'écrire une ligne de journal à l'activation et à la désactivation.

Il sert de test vivant du cycle de vie :

- `plugin.json` est validé par `npm run plugins:validate` ;
- le registre généré l'importe statiquement ;
- `plugin_state.enabled` décide de son activation, sans redéploiement.

Pour l'activer sur une base locale, après `npm run db:migrate` :

```sql
insert into public.plugin_state (plugin_id, enabled, version, granted_capabilities)
values ('hello-devnet', true, '1.0.0', '{}')
on conflict (plugin_id) do update set enabled = excluded.enabled;
```

Le runtime ne l'appelle que si son état est activé et si sa plage `devnetApi`
est compatible avec la version du SDK.
