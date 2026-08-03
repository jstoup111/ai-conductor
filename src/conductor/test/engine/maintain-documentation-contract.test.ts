import { describe, expect, it } from 'vitest';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { loadConfig } from '../../src/engine/config.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import type { HarnessConfig, StepName } from '../../src/types/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const skillName = 'maintain-documentation';
const customStep = skillName as StepName;
const canonicalDir = join(repoRoot, '.agents/skills', skillName);
const canonicalSkill = join(canonicalDir, 'SKILL.md');
const claudeSkillLink = join(repoRoot, '.claude/skills', skillName);

describe('repository-local maintain-documentation contract', () => {
  it('uses one canonical skill and remains opt-in between rebase and finish', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'maintain-documentation-contract-'));
    try {
      const canonicalBytes = await readFile(canonicalSkill).catch(() => null);
      const claudeBytes = await readFile(join(claudeSkillLink, 'SKILL.md')).catch(() => null);
      const claudeLinkStat = await lstat(claudeSkillLink).catch(() => null);
      const claudeTarget = await realpath(claudeSkillLink).catch(() => null);

      const repoConfig = await loadConfig(repoRoot);
      const configuredOrder = repoConfig.ok
        ? buildStepRegistry(repoConfig.config).map((step) => step.name)
        : [];
      const configuredRebase = configuredOrder.indexOf('rebase');
      const configuredStep = repoConfig.ok
        ? repoConfig.config.steps?.[skillName]
        : undefined;

      const missingRoot = join(scratch, 'missing-skill');
      await mkdir(join(missingRoot, '.ai-conductor'), { recursive: true });
      await writeFile(
        join(missingRoot, '.ai-conductor/config.yml'),
        `steps:\n  maintain-documentation:\n    after: rebase\n    skill: .agents/skills/maintain-documentation/SKILL.md\n    enforcement: gating\n    completion_artifact: .pipeline/maintain-documentation-pass\n`,
      );
      const missingSkillConfig = await loadConfig(missingRoot);

      const unconfigured: HarnessConfig = {
        steps: { manual_test: { disable: true } },
      };
      const unconfiguredOrder = buildStepRegistry(unconfigured).map((step) => step.name);
      const unconfiguredRebase = unconfiguredOrder.indexOf('rebase');
      const unconfiguredCompletion = await checkStepCompletion(scratch, customStep, {
        config: unconfigured,
      });

      expect({
        canonicalSkill: canonicalBytes?.includes(Buffer.from('name: maintain-documentation')),
        claudeLink: claudeLinkStat?.isSymbolicLink(),
        claudeTarget,
        byteIdentical:
          canonicalBytes !== null &&
          claudeBytes !== null &&
          canonicalBytes.equals(claudeBytes),
        repoConfigValid: repoConfig.ok,
        configuredStep,
        configuredOrder: configuredOrder.slice(configuredRebase, configuredRebase + 3),
        manualTestDisabled: repoConfig.ok
          ? repoConfig.config.steps?.manual_test?.disable
          : undefined,
        missingSkillError: missingSkillConfig.ok
          ? undefined
          : missingSkillConfig.error.message.replace(missingRoot, '<root>'),
        unconfiguredOrder: unconfiguredOrder.slice(unconfiguredRebase, unconfiguredRebase + 2),
        unconfiguredCompletion,
      }).toEqual({
        canonicalSkill: true,
        claudeLink: true,
        claudeTarget: canonicalDir,
        byteIdentical: true,
        repoConfigValid: true,
        configuredStep: {
          llm_provider: 'claude',
          after: 'rebase',
          skill: '.agents/skills/maintain-documentation/SKILL.md',
          enforcement: 'gating',
          completion_artifact: '.pipeline/maintain-documentation-pass',
        },
        configuredOrder: ['rebase', 'maintain-documentation', 'release-disposition'],
        manualTestDisabled: true,
        missingSkillError:
          'Custom step "maintain-documentation" skill file not found: <root>/.agents/skills/maintain-documentation/SKILL.md',
        unconfiguredOrder: ['rebase', 'finish'],
        unconfiguredCompletion: { done: true },
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('defines mode behavior and a PASS-only evidence lifecycle', async () => {
    const skill = await readFile(canonicalSkill, 'utf-8');
    const modeSection = (mode: string): string =>
      skill.match(new RegExp(`### ${mode}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`))?.[1] ?? '';
    const preFinish = modeSection('pre-finish');
    const documentationOnly = modeSection('documentation-only');
    const manualAudit = modeSection('manual-audit');

    expect({
      preFinish: {
        select: /Select:/i.test(preFinish),
        input: /Input:/i.test(preFinish) && /implementation/i.test(preFinish),
        output: /Output:/i.test(preFinish) && /impact verdict/i.test(preFinish),
        commit: /Commit:/i.test(preFinish) && /before PASS/i.test(preFinish),
        changelog: /Changelog:/i.test(preFinish) && /evaluate/i.test(preFinish),
        verdicts: /PASS:/i.test(preFinish) && /BLOCKED:/i.test(preFinish),
      },
      documentationOnly: {
        select: /Select:/i.test(documentationOnly),
        input: /Input:/i.test(documentationOnly) && /requested scope/i.test(documentationOnly),
        output:
          /Output:/i.test(documentationOnly) &&
          /no implementation verdict/i.test(documentationOnly),
        commit: /Commit:/i.test(documentationOnly) && /changes/i.test(documentationOnly),
        changelog:
          /Changelog:/i.test(documentationOnly) &&
          /do not (?:create|change|edit|write)/i.test(documentationOnly),
        verdicts: /PASS:/i.test(documentationOnly) && /BLOCKED:/i.test(documentationOnly),
      },
      manualAudit: {
        select: /Select:/i.test(manualAudit),
        input: /Input:/i.test(manualAudit) && /audit scope/i.test(manualAudit),
        output: /Output:/i.test(manualAudit) && /findings/i.test(manualAudit),
        commit: /Commit:/i.test(manualAudit) && /remediation/i.test(manualAudit),
        changelog:
          /Changelog:/i.test(manualAudit) && /only when/i.test(manualAudit),
        verdicts: /PASS:/i.test(manualAudit) && /BLOCKED:/i.test(manualAudit),
      },
      evidence: {
        reviewPath: skill.includes('.pipeline/maintain-documentation-review.md'),
        passPath: skill.includes('.pipeline/maintain-documentation-pass'),
        removeOldPass: /remove .*maintain-documentation-pass.*before/i.test(skill),
        overwriteReview: /overwrite .*maintain-documentation-review\.md/i.test(skill),
        neverAppendReview: /never append/i.test(skill),
        passOnly: /write .*maintain-documentation-pass.*only (?:after|for|when).*PASS/i.test(
          skill,
        ),
        blockedOmitsPass: /BLOCKED.*(?:leave|keep).*pass marker absent/is.test(skill),
        commitBeforePass: /complete .*commit.*before writing .*maintain-documentation-pass/is.test(
          skill,
        ),
        finalReviewAfterCommit:
          /complete every required commit[\s\S]*overwrite the review with the final/i.test(skill),
        recordsEvidence: /overwrite the review with .*evidence/i.test(skill),
      },
    }).toEqual({
      preFinish: {
        select: true,
        input: true,
        output: true,
        commit: true,
        changelog: true,
        verdicts: true,
      },
      documentationOnly: {
        select: true,
        input: true,
        output: true,
        commit: true,
        changelog: true,
        verdicts: true,
      },
      manualAudit: {
        select: true,
        input: true,
        output: true,
        commit: true,
        changelog: true,
        verdicts: true,
      },
      evidence: {
        reviewPath: true,
        passPath: true,
        removeOldPass: true,
        overwriteReview: true,
        neverAppendReview: true,
        passOnly: true,
        blockedOmitsPass: true,
        commitBeforePass: true,
        finalReviewAfterCommit: true,
        recordsEvidence: true,
      },
    });
  });

  it('constrains impact decisions to implementation truth and human-documentation mutations', async () => {
    const skill = await readFile(canonicalSkill, 'utf-8');
    const section = (heading: string): string =>
      skill.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';
    const impact = section('Impact decisions');
    const boundaries = section('Mutation boundaries');
    const surfaces = [
      'installation',
      'CLI',
      'workflow',
      'configuration',
      'artifact',
      'state',
      'behavior',
      'recovery',
      'extension',
      'code organization',
      'architecture',
    ];
    const containsSurface = (surface: string): boolean =>
      new RegExp(`\\b${surface.replace(' ', '\\s+')}\\b`, 'i').test(impact);
    const sourceIsFlagOnly = (source: string): boolean =>
      new RegExp(
        `${source}:[^\\n]*flag [^\\n]*only[^\\n]*do not (?:create|edit|move|rename|delete)`,
        'i',
      ).test(boundaries);
    const docsMutationIsProhibited = (verb: string): boolean =>
      new RegExp(`\\.docs\\/[^\\n]*never[^\\n]*\\b${verb}\\b`, 'i').test(boundaries);

    expect({
      surfaces: Object.fromEntries(
        surfaces.map((surface) => [surface, containsSurface(surface)]),
      ),
      authorityPrecedence:
        /implemented code, tests, generated help, schemas?, and observed behavior (?:outrank|take precedence over) `?\.docs\/`?.*context only/i.test(
          impact,
        ),
      noOpImpliesNoCommit:
        /evidence-backed no-op.*(?:create|make) no documentation commit/is.test(impact),
      obsoleteRemovalIsSafe:
        /remove obsolete human-facing.*only (?:when|if).*no dangling canonical link.*otherwise.*BLOCKED/is.test(
          impact,
        ),
      contradiction: {
        unresolvedBlocks: /unresolved contradiction.*BLOCKED/is.test(impact),
        passMarkerAbsent: /BLOCKED.*pass marker absent/is.test(impact),
      },
      sourceDocumentation: {
        comments: sourceIsFlagOnly('Inline source comments'),
        jsdoc: sourceIsFlagOnly('JSDoc'),
        docstrings: sourceIsFlagOnly('Docstrings'),
      },
      docsDirectory: {
        readOnly: /\.docs\/.*read-only/i.test(boundaries),
        create: docsMutationIsProhibited('create'),
        edit: docsMutationIsProhibited('edit'),
        move: docsMutationIsProhibited('move'),
        rename: docsMutationIsProhibited('rename'),
        delete: docsMutationIsProhibited('delete'),
        noException: /\.docs\/[\s\S]*no exception/i.test(boundaries),
      },
    }).toEqual({
      surfaces: {
        installation: true,
        CLI: true,
        workflow: true,
        configuration: true,
        artifact: true,
        state: true,
        behavior: true,
        recovery: true,
        extension: true,
        'code organization': true,
        architecture: true,
      },
      authorityPrecedence: true,
      noOpImpliesNoCommit: true,
      obsoleteRemovalIsSafe: true,
      contradiction: {
        unresolvedBlocks: true,
        passMarkerAbsent: true,
      },
      sourceDocumentation: {
        comments: true,
        jsdoc: true,
        docstrings: true,
      },
      docsDirectory: {
        readOnly: true,
        create: true,
        edit: true,
        move: true,
        rename: true,
        delete: true,
        noException: true,
      },
    });
  });

  it('defines the repository taxonomy, audience priority, and README ownership', async () => {
    const skill = await readFile(canonicalSkill, 'utf-8');
    const section = (heading: string): string =>
      skill.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';
    const taxonomy = section('Audiences and destinations');
    const readme = section('README ownership');

    expect({
      audiencePriority:
        /Audience priority:\s*1\. New users\s*2\. Operators implementing features\s*3\. Contributors modifying the codebase\s*4\. Maintainers debugging internals/i.test(
          taxonomy,
        ),
      destinations: {
        quickStart: /Quick start:/i.test(taxonomy),
        guides: /Guides:/i.test(taxonomy),
        referenceConfiguration: /Reference and configuration:/i.test(taxonomy),
        explanationDeepDives: /Explanation and deep dives:/i.test(taxonomy),
        runbooks: /Runbooks:/i.test(taxonomy),
        contributorCodeOrganization:
          /Contributor documentation and code organization:/i.test(taxonomy),
        changelog: /Changelog:/i.test(taxonomy),
      },
      destinationRules: {
        selectByPurpose: /select .*destination.*purpose/i.test(taxonomy),
        canonicalOwnership: /each fact.*one canonical (?:document|owner)/i.test(taxonomy),
        newCategoryApproval: /new category.*operator approval/i.test(taxonomy),
        flatDocsTransitional: /flat .*docs.*transitional/i.test(taxonomy),
      },
      readmeContract: {
        localRefinement: /repository-local refinement.*global harness convention/i.test(readme),
        oneLandingPage: /one concise landing page/i.test(readme),
        singleValueSection: /only in one (?:project-)?value.*section/i.test(readme),
        requirements: /requirements/i.test(readme),
        installation: /installation/i.test(readme),
        shortestQuickStart: /shortest working quick start/i.test(readme),
        docMap: /documentation map/i.test(readme),
        contributionSupport: /contribution.*support/i.test(readme),
        interactive: readme.includes('conduct-ts --interactive'),
        daemon: /daemon/i.test(readme),
        multiprovider: /multiprovider/i.test(readme),
      },
      updateBoundary: {
        canonicalAffectedDocument: /reader-visible change.*canonical affected document/is.test(
          readme,
        ),
        readmeUnchanged:
          /leave README unchanged unless.*landing-page contract/is.test(readme),
      },
      consumerIsolation:
        /consumer projects.*without.*custom (?:step )?configuration.*unchanged/is.test(readme),
    }).toEqual({
      audiencePriority: true,
      destinations: {
        quickStart: true,
        guides: true,
        referenceConfiguration: true,
        explanationDeepDives: true,
        runbooks: true,
        contributorCodeOrganization: true,
        changelog: true,
      },
      destinationRules: {
        selectByPurpose: true,
        canonicalOwnership: true,
        newCategoryApproval: true,
        flatDocsTransitional: true,
      },
      readmeContract: {
        localRefinement: true,
        oneLandingPage: true,
        singleValueSection: true,
        requirements: true,
        installation: true,
        shortestQuickStart: true,
        docMap: true,
        contributionSupport: true,
        interactive: true,
        daemon: true,
        multiprovider: true,
      },
      updateBoundary: {
        canonicalAffectedDocument: true,
        readmeUnchanged: true,
      },
      consumerIsolation: true,
    });
  });

  it('defines writing, troubleshooting, and impact-scoped verification rules', async () => {
    const skill = await readFile(canonicalSkill, 'utf-8');
    const section = (heading: string): string =>
      skill.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';
    const writing = section('Writing rules');
    const documents = section('Document rules');
    const verification = section('Verification');
    const boundaries = section('Mutation boundaries');
    const documentRule = (heading: string): string =>
      documents.match(new RegExp(`### ${heading}\\n([\\s\\S]*?)(?=\\n### |$)`))?.[1] ?? '';
    const rules = {
      quickStart: documentRule('Quick start'),
      guides: documentRule('Guides'),
      referenceConfiguration: documentRule('Reference and configuration'),
      explanationDeepDives: documentRule('Explanation and deep dives'),
      runbooks: documentRule('Runbooks'),
      contributorCodeOrganization: documentRule(
        'Contributor documentation and code organization',
      ),
      changelog: documentRule('Changelog'),
    };
    const hasWritingAndTroubleshooting = (rule: string): boolean =>
      /Writing:/i.test(rule) && /Troubleshooting:/i.test(rule);
    const verificationTargets = [
      'links',
      'paths',
      'commands',
      'configuration',
      'examples',
      'artifacts',
      'explanations',
      'code organization',
      'architecture',
      'generated help',
      'schema',
      'observed behavior',
    ];

    expect({
      globalWriting: {
        conciseActiveTaskFirst: /concise, active, task-first instructions/i.test(writing),
        noNarrative: /(?:reject|avoid|do not use) narrative/i.test(writing),
        marketingBoundary: /marketing.*only.*README.*value section/i.test(writing),
        noRepetition: /(?:reject|avoid|do not use) repetition/i.test(writing),
        noConversationalFiller:
          /(?:reject|avoid|do not use) conversational filler/i.test(writing),
        noSpeculativeCommentary:
          /(?:reject|avoid|do not use) speculative commentary/i.test(writing),
        dryHumor: /dry humor.*only when.*clarity.*unchanged/i.test(writing),
        canonicalLink: /link to the canonical source of truth/i.test(writing),
        minimumQuickStart: /repeat only.*minimum quick-start commands/i.test(writing),
      },
      documentRules: {
        quickStart:
          hasWritingAndTroubleshooting(rules.quickStart) &&
          /shortest working path/i.test(rules.quickStart),
        guides:
          hasWritingAndTroubleshooting(rules.guides) &&
          /ordered task/i.test(rules.guides),
        referenceConfiguration:
          hasWritingAndTroubleshooting(rules.referenceConfiguration) &&
          /exact/i.test(rules.referenceConfiguration),
        explanationDeepDives:
          hasWritingAndTroubleshooting(rules.explanationDeepDives) &&
          /concept/i.test(rules.explanationDeepDives),
        runbooks:
          hasWritingAndTroubleshooting(rules.runbooks) &&
          /symptom.*diagnosis.*recovery.*verification/is.test(rules.runbooks),
        contributorCodeOrganization:
          hasWritingAndTroubleshooting(rules.contributorCodeOrganization) &&
          /code paths/i.test(rules.contributorCodeOrganization),
        changelog:
          hasWritingAndTroubleshooting(rules.changelog) &&
          /reader-visible release outcome/i.test(rules.changelog),
      },
      impactScopedVerification: {
        affectedOnly: /verify only.*affected/i.test(verification),
        asApplicable: /as applicable/i.test(verification),
        targets: Object.fromEntries(
          verificationTargets.map((target) => [
            target,
            verification.toLowerCase().includes(target.toLowerCase()),
          ]),
        ),
      },
      unverifiableClaims: {
        blockRequiredClaim: /required claim.*cannot be verified.*BLOCKED/is.test(verification),
        neverGuessOrWeaken: /never guess or weaken/i.test(verification),
      },
      sourceDocumentation: {
        flagOnly: /(?:comments|JSDoc|docstrings).*flag contradictions only/is.test(boundaries),
        outsideWriteScope:
          /(?:comments|JSDoc|docstrings)[\s\S]*do not (?:create|edit|move|rename|delete)/i.test(
            boundaries,
          ),
      },
    }).toEqual({
      globalWriting: {
        conciseActiveTaskFirst: true,
        noNarrative: true,
        marketingBoundary: true,
        noRepetition: true,
        noConversationalFiller: true,
        noSpeculativeCommentary: true,
        dryHumor: true,
        canonicalLink: true,
        minimumQuickStart: true,
      },
      documentRules: {
        quickStart: true,
        guides: true,
        referenceConfiguration: true,
        explanationDeepDives: true,
        runbooks: true,
        contributorCodeOrganization: true,
        changelog: true,
      },
      impactScopedVerification: {
        affectedOnly: true,
        asApplicable: true,
        targets: {
          links: true,
          paths: true,
          commands: true,
          configuration: true,
          examples: true,
          artifacts: true,
          explanations: true,
          'code organization': true,
          architecture: true,
          'generated help': true,
          schema: true,
          'observed behavior': true,
        },
      },
      unverifiableClaims: {
        blockRequiredClaim: true,
        neverGuessOrWeaken: true,
      },
      sourceDocumentation: {
        flagOnly: true,
        outsideWriteScope: true,
      },
    });
  });

  it('defines implementation release-disposition selection and format', async () => {
    const skill = await readFile(canonicalSkill, 'utf-8');
    const changelog =
      skill.match(/## Changelog decisions\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const subsection = (heading: string): string =>
      changelog.match(new RegExp(`### ${heading}\\n([\\s\\S]*?)(?=\\n### |$)`))?.[1] ?? '';
    const selection = subsection('Selection');
    const format = subsection('Entry format');
    const blocking = subsection('Blocking validation');

    expect({
      selection: {
        notableRequired:
          /notable reader-visible implementation change.*requires a release-note disposition/i.test(
            selection,
          ),
        nonNotableMayPass: /non-notable implementation.*PASS.*explicit no-note disposition/i.test(selection),
        exclusions: {
          specOnly: /spec-only/i.test(selection),
          documentationOnly: /documentation-only/i.test(selection),
          internalNonNotable: /internal and non-notable/i.test(selection),
          noImplementationChange: /no implementation change/i.test(selection),
        },
      },
      entryFormat: {
        oneSentence: /exactly one.*sentence/i.test(format),
        presentTense: /present-tense/i.test(format),
        readerOutcomeFirst: /led by the reader outcome/i.test(format),
        prMetadata: /category and semver impact.*implementation PR metadata/i.test(format),
        noChangelogWrite: /do not edit `CHANGELOG\.md`/i.test(format),
      },
      blocking: {
        outcome: /return BLOCKED.*pass marker absent/i.test(blocking),
        missingRequiredEntry: /missing required release-note disposition/i.test(blocking),
        missingNoNote: /missing explicit no-note disposition/i.test(blocking),
        multipleSentences: /multiple sentences/i.test(blocking),
        futureTense: /future tense/i.test(blocking),
        internalMechanicsFirst: /internal mechanics first/i.test(blocking),
      },
      migrationBlocks: {
        runnable: /runnable migration blocks/i.test(format),
        separate: /separate from.*one-sentence (?:entry|release note)/i.test(format),
      },
    }).toEqual({
      selection: {
        notableRequired: true,
        nonNotableMayPass: true,
        exclusions: {
          specOnly: true,
          documentationOnly: true,
          internalNonNotable: true,
          noImplementationChange: true,
        },
      },
      entryFormat: {
        oneSentence: true,
        presentTense: true,
        readerOutcomeFirst: true,
        prMetadata: true,
        noChangelogWrite: true,
      },
      blocking: {
        outcome: true,
        missingRequiredEntry: true,
        missingNoNote: true,
        multipleSentences: true,
        futureTense: true,
        internalMechanicsFirst: true,
      },
      migrationBlocks: {
        runnable: true,
        separate: true,
      },
    });
  });

  it('aligns repository release and README policy without changing consumer defaults', async () => {
    const [claudePolicy, pullRequestTemplate] = await Promise.all([
      readFile(join(repoRoot, 'CLAUDE.md'), 'utf-8'),
      readFile(join(repoRoot, '.github/pull_request_template.md'), 'utf-8'),
    ]);
    const noReleaseContract = (policy: string) => {
      const noReleaseLine =
        policy.split(/\r?\n/).find((line) => /successful no-release path/i.test(line)) ?? '';
      return {
        successfulNoRelease: /empty `?\[Unreleased\]`?.*successful no-release path/i.test(
          noReleaseLine,
        ),
        noChangelogRewrite: /no changelog rewrite(?:,|;|\.|$)/i.test(noReleaseLine),
        noVersionBump: /no VERSION bump(?:,|;|\.|$)/i.test(noReleaseLine),
        noTag: /no tag(?:,|;|\.|$)/i.test(noReleaseLine),
        noReleaseCommit: /no release commit(?:,|;|\.|$)/i.test(noReleaseLine),
        noGitHubRelease: /no GitHub Release(?:,|;|\.|$)/i.test(noReleaseLine),
      };
    };
    const contradictionContract = (policy: string) => {
      const paragraphs = policy
        .split(/\r?\n\s*\r?\n/)
        .map((paragraph) => paragraph.replace(/\s+/g, ' '));
      return {
        noUniversalEntryRequirement: !paragraphs.some((paragraph) =>
          /(?:every|all) (?:PRs?|pull requests?).*(?:must|required to).*(?:add|include).*(?:changelog entry|entry.*CHANGELOG)|changelog entry.*required.*(?:every|all) (?:PRs?|pull requests?)|Required\. Pick one/i.test(
            paragraph,
          ),
        ),
        noEmptyFailureClaim: !paragraphs.some((paragraph) =>
          /(?:fail|error).*\[Unreleased\].*empty|empty.*\[Unreleased\].*(?:fail|error)/i.test(
            paragraph,
          ),
        ),
      };
    };
    const policyContract = (policy: string) => ({
      notableOnly:
        /changelog entry.*required only when.*notable reader-visible implementation change/is.test(
          policy,
        ),
      nonNotableAllowed:
        /non-notable implementation.*(?:may|can).*without.*changelog entry/is.test(policy),
      emptyUnreleased: noReleaseContract(policy),
      breakingMigration:
        /breaking changes.*still require.*runnable.*bash migration/is.test(policy),
      readme: {
        localRefinement: /README.*repository-local landing-page refinement/i.test(policy),
        canonicalAffectedDocs:
          /ordinary reader-visible changes.*canonical affected documentation/is.test(policy),
        unchangedUnlessLanding:
          /leave README unchanged unless.*landing-page contract/is.test(policy),
      },
      consumerIsolation:
        /consumer projects without.*custom.*configuration.*global.*unchanged/is.test(policy),
      removedContradictions: contradictionContract(policy),
    });

    expect({
      claudePolicy: policyContract(claudePolicy),
      pullRequestTemplate: {
        declaresNoNote: /Release-Disposition: no-note/.test(pullRequestTemplate),
        declaresNoteFields:
          /Release-Disposition: note[\s\S]*Release-Category:[\s\S]*Release-Semver:[\s\S]*Release-Note:/i.test(
            pullRequestTemplate,
          ),
        retainsMigration: /```bash migration/.test(pullRequestTemplate),
      },
      mutationProbes: {
        rewritesChangelog: !noReleaseContract(
          'An empty [Unreleased] is a successful no-release path that rewrites the changelog.',
        ).noChangelogRewrite,
        bumpsVersion: !noReleaseContract(
          'An empty [Unreleased] is a successful no-release path that bumps VERSION.',
        ).noVersionBump,
        createsTag: !noReleaseContract(
          'An empty [Unreleased] is a successful no-release path that creates a tag.',
        ).noTag,
        createsReleaseCommit: !noReleaseContract(
          'An empty [Unreleased] is a successful no-release path that creates a release commit.',
        ).noReleaseCommit,
        createsGitHubRelease: !noReleaseContract(
          'An empty [Unreleased] is a successful no-release path that creates a GitHub Release.',
        ).noGitHubRelease,
        universalRequirement: !contradictionContract(
          'All pull requests must add a changelog entry.',
        ).noUniversalEntryRequirement,
        emptyIsError: !contradictionContract(
          'Empty [Unreleased] is an error.',
        ).noEmptyFailureClaim,
      },
    }).toEqual({
      claudePolicy: {
        notableOnly: true,
        nonNotableAllowed: true,
        emptyUnreleased: {
          successfulNoRelease: true,
          noChangelogRewrite: true,
          noVersionBump: true,
          noTag: true,
          noReleaseCommit: true,
          noGitHubRelease: true,
        },
        breakingMigration: true,
        readme: {
          localRefinement: true,
          canonicalAffectedDocs: true,
          unchangedUnlessLanding: true,
        },
        consumerIsolation: true,
        removedContradictions: {
          noUniversalEntryRequirement: true,
          noEmptyFailureClaim: true,
        },
      },
      pullRequestTemplate: {
        declaresNoNote: true,
        declaresNoteFields: true,
        retainsMigration: true,
      },
      mutationProbes: {
        rewritesChangelog: true,
        bumpsVersion: true,
        createsTag: true,
        createsReleaseCommit: true,
        createsGitHubRelease: true,
        universalRequirement: true,
        emptyIsError: true,
      },
    });
  });
});
