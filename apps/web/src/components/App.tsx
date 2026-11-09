import { useState } from 'react';
import { Button } from './ui/pixelact-ui/button';
import { Card } from './ui/pixelact-ui/card';
import { Icon } from './Icon';
import { GitHubIcon } from './GitHubIcon';
import { github, install, workflow } from '../data/project';

function Setup() {
  const [message, setMessage] = useState('');
  const code = `${install}\npnpm exec hero-cloud analyze ./examples/spa`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setMessage('Copied!');
    } catch {
      setMessage('Select the commands to copy them manually.');
    }
  }
  return (
    <details className="developer-setup">
      <summary>
        Setting it up yourself? Show the commands <span aria-hidden="true">+</span>
      </summary>
      <div className="setup-content">
        <p>
          Install Node.js 22.12+, pnpm 9+, and Git. Run these commands in your terminal to try the
          included example. No AWS account is needed for this first step.
        </p>
        <div className="code-heading">
          <span>On your computer</span>
          <button type="button" onClick={copy}>
            <Icon name="copy" /> Copy commands
          </button>
        </div>
        <pre tabIndex={0}>
          <code>{code}</code>
        </pre>
        <p className="copy-feedback" role="status">
          {message}
        </p>
        <a href={`${github}/blob/main/apps/cli/README.md`}>Read the full instructions ↗</a>
      </div>
    </details>
  );
}

export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <a className="wordmark" href="#" aria-label="Hero Cloud home">
            <img src="/brand/hero-cloud-logo.gif" alt="Hero Cloud" width="220" height="110" />
          </a>
          <nav aria-label="Main navigation">
            <a className="how-link" href="#how-it-works">
              How it works
            </a>
            <Button asChild className="github-button">
              <a href={github}>
                <GitHubIcon /> GitHub
              </a>
            </Button>
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="container hero-content">
            <div className="hero-copy">
              <span className="alpha-label">Open source · Early alpha</span>
              <h1 id="hero-title">
                Put your
                <br />
                <span>app online.</span>
              </h1>
              <p>
                Built an app? Hero helps you put it on Amazon’s cloud, AWS. It explains what you
                need and what it could cost. <strong>You decide what happens.</strong>
              </p>
              <Button asChild className="start-button">
                <a href="#get-started">Get started</a>
              </Button>
              <span className="hero-note">Runs on your computer. Uses your AWS account.</span>
            </div>
          </div>
        </section>
        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="container">
            <h2 id="how-title">
              You bring the app.
              <br />
              Hero shows the way.
            </h2>
            <ol className="steps">
              {workflow.map((step, index) => (
                <li key={step.title}>
                  <span className={`step-icon step-${index}`}>
                    <Icon name={step.icon} />
                    <span>{index + 1}</span>
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>
            <p className="cost-note">
              <Icon name="check" /> You see estimated costs, warnings, and anything that will be
              removed before you approve.
            </p>
          </div>
        </section>
        <section className="connections" id="your-accounts" aria-labelledby="accounts-title">
          <div className="container">
            <h2 id="accounts-title">
              Your accounts.
              <br />
              Your choice.
            </h2>
            <div className="connections-grid">
              <article>
                <span className="connection-label">Your cloud</span>
                <h3>Connect your AWS account.</h3>
                <p>
                  Sign in to AWS on your computer. Hero uses that connection to put your app in your
                  own account. You keep control and pay AWS directly.
                </p>
                <p>You don’t need a Hero account. Connect locally when you’re ready to deploy.</p>
                <a href={`${github}#install`}>How to connect AWS ↗</a>
              </article>
              <article>
                <span className="connection-label">Your AI · Optional</span>
                <h3>
                  Bring your own AI.
                  <br />
                  Or skip it.
                </h3>
                <p>
                  Use your own AI provider or a model on your computer to help Hero understand your
                  app. You choose what information it can read.
                </p>
                <p>
                  Hero can analyze and plan without AI. If you use a paid provider, its fees are
                  billed separately.
                </p>
                <a href={`${github}/blob/main/packages/providers/ai/README.md`}>
                  Explore AI options ↗
                </a>
              </article>
            </div>
          </div>
        </section>
        <section className="get-started" id="get-started" aria-labelledby="start-title">
          <div className="container start-grid">
            <div className="start-copy">
              <span className="section-label">Start small.</span>
              <h2 id="start-title">
                Meet your app’s
                <br />
                new sidekick.
              </h2>
              <p>
                Try Hero on your computer. Start by letting it read your app and explain what it
                needs. This first step creates nothing in AWS.
              </p>
              <Button asChild className="blue-button">
                <a href={`${github}#install`}>
                  Open the setup guide <Icon name="arrow" />
                </a>
              </Button>
              <p className="help-note">
                Prefer a browser? Run “hero-cloud studio” and use Hero on your own computer.
              </p>
            </div>
            <Card font="normal" className="alpha-card">
              <span className="alpha-flag">Open to contributors</span>
              <h3>
                Try it.
                <br />
                Help shape it.
              </h3>
              <p>
                Hero is open source and still young. Your feedback and pull requests shape what
                comes next.
              </p>
              <p>
                A separate AWS account is a good place to start. You pay AWS for any resources you
                create.
              </p>
              <a href={`${github}/blob/main/docs/ROADMAP.md`}>See what’s ready and what’s next ↗</a>
            </Card>
            <Setup />
          </div>
        </section>
      </main>
      <footer className="community" aria-labelledby="community-title">
        <div className="container">
          <div className="community-inner">
            <div>
              <Icon name="heart" />
              <h2 id="community-title">
                Made in the open.
                <br />
                Better with you.
              </h2>
              <p>
                Use it, explore the code, suggest an idea, or help us make it easier for everyone.
              </p>
            </div>
            <Button asChild className="community-button">
              <a href={github}>
                <GitHubIcon /> Find us on GitHub
              </a>
            </Button>
          </div>
          <div className="footer-inner">
            <span>
              <strong>Hero Cloud</strong> · Free, open-source software. Apache 2.0.
              <br />
              <small>Sponsored and initially maintained by Cloud Republic.</small>
            </span>
            <nav aria-label="Project links">
              <a href={`${github}/blob/main/.github/CONTRIBUTING.md`}>Contribute</a>
              <a href={`${github}/issues`}>Get help</a>
              <a href="https://pixelactui.com">Pixelact UI</a>
            </nav>
          </div>
        </div>
      </footer>
    </>
  );
}
