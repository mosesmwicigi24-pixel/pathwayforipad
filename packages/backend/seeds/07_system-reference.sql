-- Seed: System reference data (countries + languages) for the Final Pathway
-- Portal "System" section + dashboard counts. Idempotent (ON CONFLICT) so it is
-- safe to re-run via `pnpm db:seed`; resetDb truncates first in tests.

INSERT INTO countries (code, name, flag, region, subregion, dial_code, currency, status) VALUES
  ('KE','Kenya','🇰🇪','Africa','Eastern Africa','+254','KES','active'),
  ('NG','Nigeria','🇳🇬','Africa','Western Africa','+234','NGN','active'),
  ('GH','Ghana','🇬🇭','Africa','Western Africa','+233','GHS','active'),
  ('ZA','South Africa','🇿🇦','Africa','Southern Africa','+27','ZAR','active'),
  ('UG','Uganda','🇺🇬','Africa','Eastern Africa','+256','UGX','active'),
  ('TZ','Tanzania','🇹🇿','Africa','Eastern Africa','+255','TZS','active'),
  ('SN','Senegal','🇸🇳','Africa','Western Africa','+221','XOF','inactive'),
  ('US','United States','🇺🇸','Americas','North America','+1','USD','active')
ON CONFLICT (code) DO NOTHING;

INSERT INTO languages (code, name, native_name, direction, is_default, coverage, status) VALUES
  ('en','English','English','ltr',TRUE,100,'active'),
  ('fr','French','Français','ltr',FALSE,86,'active'),
  ('sw','Swahili','Kiswahili','ltr',FALSE,72,'active'),
  ('pt','Portuguese','Português','ltr',FALSE,41,'inactive')
ON CONFLICT (code) DO NOTHING;
