// What each guide step says.
//
// The README's user guide is the reference; this is the walk-through, so it
// says less and shows more. Where the two could disagree about behaviour, the
// README (and the code) wins and this should be corrected to match.
//
// Every figure here is invented and sits inside an <Example>, never loose in
// the prose, so nothing on this screen can be mistaken for real data.
//
// The `{" "}` after some inline elements is not decoration. This toolchain
// drops the leading space of a JSX text run that contains an entity such as
// &apos;, so "<strong>book</strong> is … account&apos;s" renders as
// "bookis". An explicit space survives it.

import type { ReactNode } from "react";
import type { Book } from "@/generated/prisma/client";
import { Alert, Badge, CategoryTag } from "@/components/ui/primitives";
import { KV, PaceBar, Verdict } from "@/components/ui/data";
import { BookToggle, NAV } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { Example, MockRow, StepHeading, Term } from "./parts";

export type StepContent = {
  /** One sentence: what this step leaves you able to do. */
  lede: string;
  body: ReactNode;
  example?: ReactNode;
  /** The reasoning behind a behaviour that might otherwise look odd. */
  why?: ReactNode;
};

const mono = { fontFamily: "var(--font-mono)" } as const;

const NAV_PURPOSE: Record<string, string> = {
  budget: "Am I alright this pay period?",
  transactions: "Every transaction, filters, categorising, cash",
  transfers: "Moves between your own accounts, to confirm",
  reports: "Financial-year figures, GST, the IR3 pack",
  setup: "Budget amounts, fixed bills, payday",
  review: "Close last period, set this one",
  sync: "Is the bank feed still arriving?",
};

export function stepContent(slug: string, book: Book): StepContent {
  switch (slug) {
    case "welcome":
      return {
        lede: "A quick tour of the whole app, one screen at a time.",
        body: (
          <>
            <p>
              Money Book pulls every transaction from your ANZ and BNZ accounts
              through Akahu (the service that connects to the banks) once a day
              at 7am, sorts them into categories, and turns them into three
              things: a budget for this pay period, a set of tax figures for the
              financial year, and a daily check that the bank feed is still
              healthy.
            </p>
            <p>
              Each step covers one job. Use <strong>Next</strong> to go in
              order, or jump to any step from the list. Most steps end with a
              button that opens the real screen, so you can look at your own
              figures and come back.
            </p>
            <StepHeading>One thing to keep in mind</StepHeading>
            <p>
              The app rarely breaks loudly. The thing to watch for is a figure
              that is quietly wrong because something upstream is missing: an
              uncategorised transaction, an unconfirmed transfer, a sync that
              stopped. The steps point out where each of those shows up.
            </p>
          </>
        ),
        example: (
          <Example caption="Each step has a box like this one. The figures in it are invented, never yours.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Verdict deltaCents={3720} size="lg" />
              <Badge tone="ok">balanced</Badge>
              <CategoryTag name="Groceries" book="PERSONAL" />
            </div>
          </Example>
        ),
      };

    case "getting-around":
      return {
        lede: "Where the menu is, and what the header at the top of every screen tells you.",
        body: (
          <>
            <p>
              On a desktop the menu is a sidebar on the left. On a phone it
              becomes a tab bar along the bottom with shorter labels. Two
              screens have no menu item and are linked from Budget instead:{" "}
              <em>How past periods went</em> and <em>Savings goals</em>.
            </p>
            <StepHeading>The header</StepHeading>
            <ul>
              <li>
                <strong>Pay period</strong>: the current period (say 20 Oct to
                19 Nov) and how many days until payday.
              </li>
              <li>
                <strong>Personal / Business</strong>: which set of books you are
                looking at. Switching keeps you on the same screen.{" "}
                <strong>Try it in the box below</strong>, or in the header
                above: this page stays put.
              </li>
              <li>
                <strong>Sync</strong>{" "}(desktop only) opens Sync status. It
                doesn&apos;t fetch anything itself.
              </li>
              <li>
                <strong>Sign out</strong>, at every width. Use it on a phone
                you might lose; a session otherwise lasts 30 days.
              </li>
            </ul>
          </>
        ),
        example: (
          <Example caption="The toggle here is live. It changes the book in the address, which is why a business view can be bookmarked.">
            <div className="mb-stack-sm">
              <BookToggle
                value={book}
                basePath="/guide"
                preserve="step=getting-around"
              />
              <div className="mb-guide-navmap">
                {NAV.map((item) => (
                  <div key={item.key} className="mb-guide-navmap-row">
                    <span style={{ color: "var(--text-primary)" }}>
                      {item.label}
                      <span style={{ color: "var(--text-muted)" }}>
                        {" "}
                        · {item.short}
                      </span>
                    </span>
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {NAV_PURPOSE[item.key]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Example>
        ),
      };

    case "two-books":
      return {
        lede: "Personal and Business are kept apart, and the difference between a transfer and an owner payment.",
        body: (
          <>
            <p>
              A <strong>book</strong>{" "}is a separate set of accounts. Personal is
              your own money; Business is Tommy Tinkers. Every account and every
              category belongs to exactly one book, and a transaction can only
              take a category from its own account&apos;s book.
            </p>
            <dl className="mb-guide-terms">
              <Term word="Transfer">
                Money moved between two of your own accounts in the{" "}
                <em>same</em> book. Both halves are linked as a pair and add up
                to zero, so it is neither income nor spending.
              </Term>
              <Term word="Owner">
                Money moved <em>between</em>{" "}the books, such as personal money
                paid into the business account. To the business that is
                owner&apos;s funds or drawings, not a transfer.
              </Term>
              <Term word="Needs mapping">
                A new bank account that hasn&apos;t been given a book yet. Its
                transactions can&apos;t be categorised until it has one.
              </Term>
            </dl>
          </>
        ),
        example: (
          <Example caption="The coloured dot is how the app shows a book: amber for Personal, blue for Business.">
            <MockRow
              left="ANZ Everyday → ANZ Bills"
              sub={
                <>
                  <CategoryTag name="Internal Transfer" book="PERSONAL" />
                  <span>same book, nets to zero</span>
                </>
              }
              right={formatNZD(0)}
              rightTone="var(--money-transfer)"
            />
            <MockRow
              left="ANZ Everyday → BNZ Tommy Tinkers"
              sub={
                <>
                  <CategoryTag name="Owner Contribution" book="BUSINESS" />
                  <span>crosses books</span>
                </>
              }
              right={formatNZD(50000)}
              rightTone="var(--money-in)"
            />
            <MockRow
              left="BNZ Credit Card (new)"
              sub={<Badge tone="warning">needs mapping</Badge>}
            />
          </Example>
        ),
        why: (
          <p>
            The business figures end up on a real IR3 return. If a personal
            category could land on a business transaction, the tax figures
            would be wrong while every total still balanced, which is the hardest
            kind of wrong to notice.
          </p>
        ),
      };

    case "budget":
      return {
        lede: "Read the Budget screen in ten seconds: what is safe to spend, and whether you are on pace.",
        body: (
          <>
            <p>
              Budget is the home screen. It answers one question first:{" "}
              <em>am I alright this pay period?</em>
            </p>
            <dl className="mb-guide-terms">
              <Term word="Safe to spend today">
                Money in the bank, minus bills that haven&apos;t come out yet,
                minus everyday budgets you haven&apos;t touched. Under it is
                the same figure per day until payday.
              </Term>
              <Term word="Pace">
                How much of a budget you&apos;d expect to have used by today if
                you spent evenly across the period. The thin line on each bar
                marks it.
              </Term>
              <Term word="Fixed bill">
                A budget line with a due day, like rent. It is held aside in
                full until it comes out, rather than paced.
              </Term>
            </dl>
            <p>
              Everyday categories are listed worst pace first, so the one to
              worry about is at the top. Tap one for its daily pattern, its
              transactions and a trend chart.
            </p>
          </>
        ),
        example: (
          <Example caption="The line is where even spending would have you today. Takeaways is well past it, so it turns amber; Groceries is behind it, which is fine.">
            <div className="mb-stack-sm">
              <div>
                <div className="mb-guide-eyebrow">Safe to spend today</div>
                <div className="mb-figure-md" style={{ color: "var(--text-primary)" }}>
                  {formatNZD(41230)}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  {formatNZD(5154)} a day for 8 days
                </div>
              </div>
              <Verdict deltaCents={3720} size="lg" />
              <div className="mb-stack-sm" style={{ marginTop: "var(--space-2)" }}>
                <div>
                  <KV label="Takeaways &amp; Cafes" value={`${formatNZD(14250)} of ${formatNZDWhole(15000)}`} />
                  <div style={{ marginTop: 8 }}>
                    <PaceBar spentCents={14250} budgetCents={15000} markerPct={73} />
                  </div>
                </div>
                <div>
                  <KV label="Groceries" value={`${formatNZD(39140)} of ${formatNZDWhole(60000)}`} />
                  <div style={{ marginTop: 8 }}>
                    <PaceBar spentCents={39140} budgetCents={60000} markerPct={73} />
                  </div>
                </div>
              </div>
            </div>
          </Example>
        ),
        why: (
          <p>
            A bar at 60% means nothing on its own: on day 6 of the period it is
            a problem, on day 27 it isn&apos;t. The pace line does that sum for
            you, so the comparison is something you see rather than work out.
          </p>
        ),
      };

    case "warnings":
      return {
        lede: "The two warnings at the top of Budget, and why they come before every other figure.",
        body: (
          <>
            <p>
              Two warnings can appear above everything else on Budget. Both
              mean every figure below them is <strong>too low</strong>, because
              spending the app can&apos;t place is spending it can&apos;t count.
            </p>
            <ul>
              <li>
                <strong>N transactions have no category.</strong> Follow the
                link and categorise them (the next step shows how).
              </li>
              <li>
                <strong>N accounts are not assigned to a set of books.</strong>{" "}
                A new account turned up. Give it a book from the command line
                with <code>npm run accounts:map</code>.
              </li>
            </ul>
            <p>
              Clear these first, then read the rest of the screen.
            </p>
          </>
        ),
        example: (
          <Example caption="If you see either of these, the safe-to-spend figure is too generous.">
            <div className="mb-stack-sm">
              <Alert>
                <strong>12 transactions have no category.</strong>{" "}
                They aren&apos;t counted in any budget yet.
              </Alert>
              <Alert>
                <strong>1 account is not assigned to a set of books.</strong>{" "}
                Run <code>npm run accounts:map</code>.
              </Alert>
            </div>
          </Example>
        ),
      };

    case "transactions":
      return {
        lede: "Find any transaction, fix its category, and make sure the fix sticks.",
        body: (
          <>
            <p>
              Transactions opens on the current pay period. Each row says what
              it did to the budget, such as <em>$108.60 left in Groceries</em>.
              Filter by text, account, category or a date range, or tick{" "}
              <strong>Needs a category</strong> to see the queue. Filters live
              in the address, so a filtered view can be bookmarked.
            </p>
            <StepHeading>Fixing a category</StepHeading>
            <ul>
              <li>
                <strong>One row:</strong> tap it, change the category, save.
              </li>
              <li>
                <strong>Many rows:</strong> tick them, pick a category in the
                bar at the bottom, then <strong>Apply to N selected</strong>.
                The bulk bar offers expense categories only, and needs
                JavaScript.
              </li>
            </ul>
            <p>
              A category you set by hand is marked as decided by you, and no
              rule or sync will ever change it back. If the same fix keeps
              coming up, it wants a rule instead, which lives in code (see the
              README, <em>Fixing a category that&apos;s wrong</em>).
            </p>
            <p>
              You can&apos;t change a bank transaction&apos;s date, amount or
              description, because those are the bank&apos;s record. You can
              add notes.
            </p>
          </>
        ),
        example: (
          <Example caption="The badges: cash (you typed it in), transfer (part of a confirmed pair), and Needs a category.">
            <MockRow
              left="Pak'nSave Westgate"
              sub={
                <>
                  <CategoryTag name="Groceries" book="PERSONAL" />
                  <span>{formatNZD(10860)} left in Groceries</span>
                </>
              }
              right={`−${formatNZD(8742)}`}
              rightTone="var(--money-out)"
            />
            <MockRow
              left="POS W/D Helensville Bakery"
              sub={<Badge tone="warning">Needs a category</Badge>}
              right={`−${formatNZD(1450)}`}
              rightTone="var(--money-out)"
            />
            <MockRow
              left="Farmers market"
              sub={
                <>
                  <Badge>cash</Badge>
                  <CategoryTag name="Groceries" book="PERSONAL" />
                </>
              }
              right={`−${formatNZD(2000)}`}
              rightTone="var(--money-out)"
            />
            <MockRow
              left="To ANZ Savings"
              sub={<Badge>transfer</Badge>}
              right={`−${formatNZD(20000)}`}
              rightTone="var(--money-transfer)"
            />
          </Example>
        ),
        why: (
          <p>
            Without the &ldquo;decided by you&rdquo; mark, the next morning&apos;s
            sync would re-run the rules and silently undo your correction. A
            fix that doesn&apos;t stay fixed is worse than no fix, because you
            stop checking.
          </p>
        ),
      };

    case "cash":
      return {
        lede: "Record spending the bank never saw, without counting the same money twice.",
        body: (
          <>
            <p>
              <strong>Transactions → Add cash entry</strong>{" "}records cash you
              spent: pick the book, date, description, amount, in or out, and
              optionally a category from that book. It goes to the book&apos;s
              Cash account, and unlike bank rows you can edit it later.
            </p>
            <StepHeading>The trap</StepHeading>
            <p>
              Only add cash that has <em>no bank withdrawal</em> behind it. A
              withdrawal categorised as <em>Cash Withdrawals</em> already counts
              as spending. Adding what you bought with that cash counts the
              same money a second time, in both Budget and Reports.
            </p>
            <p>
              First time only: run <code>npm run accounts:seed-cash</code>{" "}to
              create the Cash accounts, or the entry won&apos;t save.
            </p>
          </>
        ),
        example: (
          <Example caption="Same $100 note, counted twice.">
            <MockRow
              left="ATM withdrawal"
              sub={<CategoryTag name="Cash Withdrawals" book="PERSONAL" />}
              right={`−${formatNZD(10000)}`}
              rightTone="var(--money-out)"
            />
            <MockRow
              left="Cash entry: fish and chips"
              sub={<Badge tone="error">already counted above</Badge>}
              right={`−${formatNZD(4000)}`}
              rightTone="var(--money-out)"
            />
            <div style={{ paddingTop: "var(--space-3)" }}>
              <KV
                label="Budget thinks you spent"
                value={formatNZD(14000)}
                tone="var(--status-error)"
              />
              <KV label="You actually spent" value={formatNZD(10000)} />
            </div>
          </Example>
        ),
      };

    case "transfers":
      return {
        lede: "Clear the queue of money moved between your own accounts, so it stops counting as income and spending.",
        body: (
          <>
            <p>
              Until a transfer is confirmed, the app sees two unrelated
              transactions: money out of one account (spending) and money into
              another (income). Confirming links them as a pair that nets to
              zero.
            </p>
            <p>
              Pairs the app can prove, like ANZ transfers where each side names
              the other account, are handled without you. The Transfers screen
              holds the ones that need a human:
            </p>
            <ul>
              <li>
                <strong>High, Medium and Low confidence</strong> groups are
                uncontested: each payment out has exactly one possible match.
                One button confirms the whole group.
              </li>
              <li>
                <strong>Contested</strong> pairs have no button, on purpose. One
                payment out has two or more possible matches. Sort these from
                the command line with <code>npm run transfers:detect</code>.
              </li>
              <li>
                <strong>Owner, not transfer</strong> marks a pair that crosses
                books.
              </li>
            </ul>
          </>
        ),
        example: (
          <Example caption="Uncontested: one match each way. Contested: two candidates, so the app won't guess.">
            <MockRow
              left="ANZ Everyday → ANZ Savings"
              sub={
                <>
                  <Badge tone="ok">High confidence</Badge>
                  <span>same day, same amount</span>
                </>
              }
              right={formatNZD(50000)}
              rightTone="var(--money-transfer)"
            />
            <MockRow
              left={`${formatNZD(8500)} out of ANZ Everyday`}
              sub={
                <>
                  <Badge tone="warning">Contested</Badge>
                  <span>two $85.00 deposits landed that day: your own transfer arriving, or a flatmate paying you?</span>
                </>
              }
              right="2 matches"
              rightTone="var(--status-warning)"
            />
          </Example>
        ),
        why: (
          <p>
            A standing order and a flatmate&apos;s payment can share a day and
            an amount. Pick the wrong one and real income disappears into a
            &ldquo;transfer&rdquo;, with every total still balancing. Making
            contested pairs a deliberate command keeps that from being one
            careless tap.
          </p>
        ),
      };

    case "set-budget":
      return {
        lede: "Give each category an amount, mark the bills, and set your payday.",
        body: (
          <>
            <ul>
              <li>
                One amount per category, all saved together with one{" "}
                <strong>Save</strong>.
              </li>
              <li>
                Tick <strong>fixed</strong> and give a due day for bills.{" "}
                <strong>Pin all N bills</strong> fills these in from bills the
                app has noticed recurring.
              </li>
              <li>
                <strong>Pay cycle</strong>: the day of the month payday lands
                on, which is where each period starts (the 20th by default).
              </li>
              <li>
                <strong>Show half a period at a time</strong>{" "}halves what Safe
                to spend shows, if a month&apos;s money is hard to pace. Display
                only: no stored figure changes.
              </li>
            </ul>
            <p>
              A budget carries forward. A category without a new figure this
              period uses its most recent one, so you only change what changes.
            </p>
            <p>
              No budget yet? The Budget screen offers to build one from your
              average spending over the last three periods. Nothing is saved
              until you press Save.
            </p>
          </>
        ),
        example: (
          <Example>
            <MockRow
              left="Groceries"
              sub={<span>everyday</span>}
              right={formatNZDWhole(60000)}
            />
            <MockRow
              left="Home Rent"
              sub={
                <>
                  <Badge>fixed</Badge>
                  <span>due on the 1st</span>
                </>
              }
              right={formatNZDWhole(210000)}
            />
            <MockRow
              left="Vehicle — Fuel"
              sub={<span>no new figure: still using last period&apos;s</span>}
              right={formatNZDWhole(28000)}
              rightTone="var(--text-tertiary)"
            />
          </Example>
        ),
      };

    case "month-end":
      return {
        lede: "Close the last period with one decision per category: keep, carry or match.",
        body: (
          <>
            <p>
              After payday, open <strong>Month end</strong>. It lists last
              period category by category with what you budgeted and what you
              spent. Pick one of three for each:
            </p>
            <dl className="mb-guide-terms">
              <Term word="Keep">The same budget again.</Term>
              <Term word="Carry">
                The same budget plus what you underspent, or minus what you
                overspent (shown as &ldquo;Repay&rdquo;), for this period only.
              </Term>
              <Term word="Match">Set the budget to what you actually spent.</Term>
            </dl>
            <p>
              Decisions apply to the current period. Last period&apos;s figures
              are never rewritten, so you can reopen the review later and still
              see what was budgeted at the time.
            </p>
          </>
        ),
        example: (
          <Example caption="Each figure on the right is what that choice sets as this period's Groceries budget. Last period's row is left as it was.">
            <div
              className="mb-stack-sm"
              style={{ paddingBottom: "var(--space-3)", borderBottom: "1px solid var(--border-default)" }}
            >
              <div className="mb-guide-eyebrow">Groceries, last period</div>
              <KV label="Budgeted" value={formatNZD(60000)} />
              <KV label="Spent" value={formatNZD(54000)} tone="var(--money-out)" />
            </div>
            <MockRow left="Keep" sub={<span>same again</span>} right={formatNZD(60000)} />
            <MockRow
              left="Carry"
              sub={<span>plus the {formatNZD(6000)} you didn&apos;t spend</span>}
              right={formatNZD(66000)}
              rightTone="var(--money-in)"
            />
            <MockRow
              left="Match"
              sub={<span>what you actually spent</span>}
              right={formatNZD(54000)}
            />
          </Example>
        ),
      };

    case "history-goals":
      return {
        lede: "See which categories run over every time, and track savings against the real bank balance.",
        body: (
          <>
            <StepHeading>How past periods went</StepHeading>
            <p>
              Linked from the bottom of Budget. The last six{" "}
              <em>complete</em> pay periods against budget, which categories
              run over every time, which are padded, and a suggested adjustment
              where the pattern is steady. The running period is left out:
              halfway through, everything looks under budget.
            </p>
            <StepHeading>Savings goals</StepHeading>
            <p>
              Personal book only, linked from Budget. A goal is one savings
              account, a target and, optionally, a date. Progress <em>is</em>{" "}
              the account&apos;s bank balance, so it can&apos;t drift from the
              bank. With a date it shows what to put in each pay period, your
              recent average, and a projected finish. One active goal per
              account. Goals are display only and change nothing on Budget.
            </p>
          </>
        ),
        example: (
          <Example caption="Putting in less than needed, so the projected finish lands after the target date.">
            <div className="mb-stack-sm">
              <div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: "var(--weight-semibold)" }}>
                  Emergency fund
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  ANZ Savings · target {formatNZDWhole(500000)} by 01/04/2027
                </div>
              </div>
              <div className="mb-figure-md">
                {formatNZD(320000)}
              </div>
              <PaceBar spentCents={320000} budgetCents={500000} tone="ok" />
              <KV label="Needed each pay period" value={formatNZD(36000)} />
              <KV label="Your recent average" value={formatNZD(30000)} tone="var(--status-warning)" />
              <KV label="Projected finish" value="20/04/2027" tone="var(--status-warning)" />
            </div>
          </Example>
        ),
      };

    case "reports":
      return {
        lede: "Pull the financial-year figures, keep an eye on GST, and hand your accountant the IR3 pack.",
        body: (
          <>
            <p>
              Reports run on a different calendar from the budget, on purpose.
              The budget runs on pay periods (20th to 19th). Reports run on the{" "}
              <strong>financial year</strong> (FY, 01/04 to 31/03) and calendar
              months, because that is what IRD uses. They never line up, so
              every report figure prints its exact date range. Check it before
              quoting a number.
            </p>
            <ul>
              <li>
                <strong>Reports</strong>: money in, out and net for the FY,
                plus the <strong>GST monitor</strong>. Business sales over $60,000
                in any 12 months means you must register for GST.
              </li>
              <li>
                <strong>By category</strong> and <strong>Month by month</strong>{" "}
                break that down.
              </li>
              <li>
                <strong>IR3 pack</strong> covers both books at once (the IR3 is
                the tax return for income beyond a salary). Enter the Ray White
                management fee and the ASB mortgage interest once a year, read
                every warning, then <strong>Export</strong> the .xlsx.
              </li>
            </ul>
            <p>
              The app prepares figures and lists the open questions. Filing and
              the judgement calls stay with you and your accountant.
            </p>
          </>
        ),
        example: (
          <Example caption="Rolling 12 months, so this moves every day rather than resetting on 01/04.">
            <div className="mb-stack-sm">
              <div className="mb-guide-eyebrow">GST registration monitor</div>
              <KV label="Business sales, last 12 months" value={formatNZD(1425000)} />
              <PaceBar spentCents={1425000} budgetCents={6000000} tone="ok" />
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                <span style={mono}>01/11/2025 – 31/10/2026</span> · threshold{" "}
                {formatNZDWhole(6000000)}
              </div>
            </div>
          </Example>
        ),
        why: (
          <p>
            Two figures the IR3 needs never pass through the bank feed. Leave
            the mortgage interest blank and the pack keeps mortgage repayments
            out of the deductions entirely and says so loudly, rather than
            claiming the whole repayment. On a document going to IRD, that is
            the safe direction to be wrong in.
          </p>
        ),
      };

    case "sync":
      return {
        lede: "Tell a healthy quiet day from a sync that has stopped.",
        body: (
          <>
            <p>
              A sync that has quietly stopped looks exactly like a day with
              nothing new. When figures look stale, check here.
            </p>
            <dl className="mb-guide-terms">
              <Term word="Reconciliation">
                Checking that the transactions held add up to the bank&apos;s
                own balance. <strong>Drift</strong> is the difference; zero is
                good.
              </Term>
              <Term word="Pending">
                Card payments the bank has authorised but not settled. Normal on
                card accounts; they arrive in the feed once they settle.
              </Term>
              <Term word="Already held">
                In the run history, rows the sync saw and already had. Each sync
                re-reads the last seven days to catch late postings, so some of
                these are healthy.
              </Term>
            </dl>
            <p>
              <em>Needs re-consent</em>{" "}means Akahu&apos;s access to that bank
              has lapsed: reconnect it at my.akahu.nz and the next sync catches
              up. Want a sync right now? It&apos;s a command, not a button (see
              the README, <em>Run a sync right now</em>).
            </p>
          </>
        ),
        example: (
          <Example caption="Account badges on Sync status.">
            <MockRow left="ANZ Everyday" sub={<Badge tone="ok">balanced</Badge>} right={formatNZD(184215)} />
            <MockRow
              left="BNZ Credit Card"
              sub={
                <>
                  <Badge tone="ok">balanced</Badge>
                  <Badge>{formatNZD(3520)} pending</Badge>
                </>
              }
              right={`−${formatNZD(41290)}`}
            />
            <MockRow left="ANZ Bills" sub={<Badge tone="warning">drift {formatNZD(1240)}</Badge>} right={formatNZD(52000)} />
            <MockRow left="BNZ Tommy Tinkers" sub={<Badge tone="error">needs re-consent</Badge>} right={formatNZD(96000)} />
          </Example>
        ),
      };

    case "routine":
      return {
        lede: "That's the tour. Here is the rhythm that keeps the figures honest.",
        body: (
          <>
            <dl className="mb-guide-terms">
              <Term word="Every day">
                Open Budget. Clear any warnings at the top, then read Safe to
                spend and the verdict.
              </Term>
              <Term word="Every week">
                Transactions → Needs a category, and clear the Transfers queue.
              </Term>
              <Term word="Each payday">
                Month end: keep, carry or match each category. Glance at How
                past periods went.
              </Term>
              <Term word="Once a year">
                After 31/03, open the IR3 pack, enter the two yearly figures,
                read the warnings and export.
              </Term>
              <Term word="When numbers look off">
                Sync status first, then the warnings on Budget, then
                Transfers.
              </Term>
            </dl>
            <p>
              The full reference, including the command-line jobs, is the user
              guide in the README. You can come back to this tour any time from
              the sidebar or the bottom of Budget.
            </p>
          </>
        ),
      };

    default:
      return { lede: "", body: null };
  }
}
