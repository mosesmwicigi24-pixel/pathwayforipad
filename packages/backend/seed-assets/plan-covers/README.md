# Reading-plan cover art

Generated, on-brand (navy/gold) covers for seeded reading plans. Produced by
`generate.py` (Pillow). Deployed to the VPS media volume and served at
`https://pathway.nuruplace.org/media/<file>.png` (referenced by migration
`1758000000062_seed-plans-saved-grief.sql` + the Anchored seed in migration 61).

Regenerate + redeploy:
```
python3 generate.py                  # writes /tmp/plan-*.png
scp /tmp/plan-*.png root@<vps>:/var/www/pathway-media/
```
