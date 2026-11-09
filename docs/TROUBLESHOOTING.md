# Troubleshooting

| You see                                             | What it means                                                                     | What to do                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Exit code 3, "Before this can go online"            | The plan needs something from you (an answer, or a capability Hero cannot do yet) | Read the list; answer with `--answer <question>=<answer>` and run again        |
| "You are signed in to AWS as the account owner"     | Hero refuses root credentials                                                     | Use a limited user, role, or SSO profile (`--profile <name>`)                  |
| "The credentials belong to another account"         | The plan was approved for a different account                                     | Plan again with the credentials you want to use                                |
| Exit code 4                                         | It deployed, but the checks did not show it working                               | Run `health`, read the failed check, then look at the logs link                |
| "Another deployment of this app is already running" | A lock is held by another run                                                     | Wait for it, or remove a stale `.hero/locks/<name>.lock` if nothing is running |
| `plan.update-unverified` warning                    | Hero could not compare with what is deployed                                      | Treat the list as a template, not a diff; re-plan online with credentials      |
| "Hero did not recognize this application"           | No known stack was found                                                          | Run `hero-cloud report <source>`, read it, and share it if you choose to       |
| Slow first `plan`                                   | Public AWS prices are being downloaded                                            | Use `--offline` for built-in prices, or wait once; they are cached             |

Set `HERO_DEBUG=1` for technical detail on errors. It never prints credentials or secret values.
