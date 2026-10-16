# Bill Filing → Wheredoc: how to switch it on

Invoice Processing's last step, **Bill Filing** (Tapan), now has a **File** button instead of
**Done**. Tapan fills in a short form and JainE:

1. creates the bill in Wheredoc, with the **JainE Id as its DocId**;
2. uploads the bill's files to Wheredoc (the first file is the bill, the rest go on as attachments,
   up to 10 MB each, stored in Wheredoc's own S3);
3. files it in the chosen **box file**, or in a new box file he describes;
4. only then completes the step. If anything fails, nothing is completed and the step stays with him.

The form asks for:
- **bill type**: Contractor, Material, Manpower, Service, Freight or Other Bill, as on Wheredoc's
  Bills form;
- **project**: a Wheredoc site;
- **credit period**: 15 days by default;
- **GST invoice** and **remarks**;
- **box file**: a searchable list, or "New box file".

Bill No., Bill Date, Vendor and Amount are filled from the instance and can be corrected. A new
vendor is added to Wheredoc's parties, as Wheredoc's own screen would add it.

## What changes in Wheredoc

Nothing that already exists changes behaviour. The commit adds:

| File | What it does |
|---|---|
| `app/controllers/api/jaine_controller.rb` (new) | The bridge. It is used only with the secret token, and it is off until `JAINE_API_TOKEN` is set. |
| `config/routes.rb` | Two routes: `GET /api/jaine/options`, `POST /api/jaine/bills`. |
| `app/controllers/user_controller.rb` + `app/views/user/docid_choice.html.erb` (new) | When one DocId belongs to two documents (a JainE bill and a Wheredoc bill), the DocId report first lists both to pick from. A DocId with one document opens exactly as before. |
| `lib/tasks/revert_cheque_disbursal.rake` | When a DocId is shared, it picks the document that actually has the cheque disbursal. |

Wheredoc's own DocId counter is **not** touched. A JainE bill's description is `JAINE-<id>`, so it
can be found by searching, and a retry never makes a second bill.

All of this was tested against a local copy of Wheredoc with a test database:
- access refused without the token or with a wrong one;
- only the user's own organisation's sites and box files are offered;
- a bill is created, its files attached, and it is filed;
- a retry returns the same bill;
- each wrong input is refused with nothing left behind;
- a new box file is made exactly as the Folders screen makes it;
- files over 10 MB are refused;
- the DocId report lists both documents for a shared DocId, opens either one, and opens a unique
  DocId straight away.

## Switching it on (you do these; no secret is ever typed into chat)

1. **Make one random token**: a long random string, 40 characters or more, for example from a
   password generator.
2. **Wheredoc (Heroku)**:
   - deploy the new Wheredoc commit (from `Downloads\wheredoc2\wheredoc2`);
   - then go to Settings → Config Vars → add `JAINE_API_TOKEN` = the token.
3. **Supabase** → Edge Functions → Secrets → add:
   - `WHEREDOC_URL` = Wheredoc's address, e.g. `https://tracemydoc.herokuapp.com` (no slash at the
     end);
   - `WHEREDOC_API_TOKEN` = the same token.
4. **JainE**: deploy as usual (Netlify), so the File button appears.
5. **Check**: Tapan opens any Bill Filing step and presses **File**. If the form shows Wheredoc's
   projects and box files, it is connected. Until then the form says what is missing.

Tapan must be a Wheredoc user with the same email as in JainE (`tapan@thejaingroup.com`). Whoever
presses File is the person the bill is originated by in Wheredoc.
