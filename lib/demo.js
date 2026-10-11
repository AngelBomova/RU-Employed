// Explicit, offline simulation for the hackathon walkthrough. No AI claims.
export const DEMO_MATERIALS = {
  resume:
    "Alex Rivera — Computer Science student at Rutgers University. Built CampusConnect, a React and Node.js app that matches students to study groups. Led API design, added PostgreSQL indexes to reduce search latency by 40%, and collaborated with three teammates. Interned at a local nonprofit, automating volunteer scheduling with Python and saving the coordinator four hours a week.",
  linkedin:
    "Interested in accessible software, thoughtful product design, and collaborative engineering.",
  portfolio:
    "CampusConnect: full-stack study-group matching app. Volunteer Scheduler: Python automation for a nonprofit.",
  job: "Brightside — Software Engineer Intern. We build accessible tools that help communities collaborate. Work with React, Node.js, PostgreSQL, and Python. We value ownership, clear communication, testing, and thoughtful engineering tradeoffs.",
  notes: "Fictional sample candidate and company for a guided demo.",
};

export function demoPlan({ focus = "mixed", length = "short" } = {}) {
  const intro =
    "Tell me a little about yourself and what draws you to building software that helps communities.";
  const behavioral = [
    "On CampusConnect, you worked with three teammates. Tell me about a disagreement and how you helped the team move forward.",
    "Your volunteer scheduling project saved a nonprofit four hours a week. How did you understand their problem and measure that result?",
    "Tell me about a time something didn't go to plan. What did you change, and what did you learn?",
    "Describe a time you received difficult feedback and acted on it.",
    "How would you explain a technical limitation to a teammate who isn't an engineer?",
    "Tell me about a time you had to learn a new skill quickly. How did you approach it?",
    "How do you prioritize when several teammates need your help at once?",
  ];
  const technical = [
    "You reduced CampusConnect search latency by 40%. Walk me through how you found the bottleneck and why you chose PostgreSQL indexes.",
    "How would you design an API to match students to study groups? Talk through your data model and one tradeoff.",
    "How would you test the volunteer scheduler, including a failure case?",
    "What would you change in CampusConnect if the number of users grew tenfold?",
    "How would you make the study-group search interface accessible to keyboard and screen-reader users?",
    "What would you log to diagnose a failure in the volunteer scheduler?",
    "How would you avoid two students joining the last available spot in a study group at the same time?",
  ];
  const middle =
    focus === "behavioral"
      ? behavioral
      : focus === "technical"
        ? technical
        : behavioral.flatMap((q, i) => [q, technical[i]]);
  const count = { short: 4, standard: 6, long: 9 }[length] || 4;
  const questions = [
    intro,
    ...middle,
    "Why does Brightside's mission interest you? How would your experience help our team?",
    "What would you like to ask me about the role?",
  ];
  return {
    candidate_name: "Alex",
    company: "Brightside",
    role: "Software Engineer Intern",
    company_mission:
      "Build accessible tools that help communities collaborate.",
    interviewer: { name: "Rachel", title: "Engineering Manager" },
    format_summary: `${count} ${focus === "mixed" ? "behavioral and technical" : focus} questions · fictional candidate and company · guided demo`,
    key_requirements: [
      "Clear communication",
      "React and Node.js",
      "Testing",
      "Engineering tradeoffs",
    ],
    questions: questions.slice(0, count).map((question, i) => ({
      id: `q${i + 1}`,
      question,
      category: i === 0 ? "intro" : "behavioral",
      grounded_in: "Fictional sample resume",
      probing_for: "Specific examples and clear reasoning",
      follow_ups: [],
    })),
  };
}

export function demoTurn(session, candidateText) {
  const index = session.turns.filter((t) => t.role === "candidate").length;
  if (candidateText === null)
    return {
      say: `Hi Alex, I'm ${session.plan.interviewer.name}, the engineering manager at Brightside. This is a guided demo using a fictional profile. ${session.plan.questions[0].question}`,
      question_id: "q1",
      end_interview: false,
    };
  const q = session.plan.questions[index + 1];
  return q
    ? {
        say: `Thanks for walking me through that. ${q.question}`,
        question_id: q.id,
        end_interview: false,
      }
    : {
        say: "Thanks for sharing your experience with me. That wraps up our practice conversation. Let's look at a few ways to make your answers stronger.",
        question_id: "none",
        end_interview: true,
      };
}

export function demoFeedback(session) {
  const answers = [];
  let question = session.plan.questions[0].question;
  for (const turn of session.turns) {
    if (turn.role === "interviewer") {
      question = turn.text;
      continue;
    }
    if (turn.role !== "candidate" || !turn.text) continue;
    const text = turn.text;
    const situation =
      /\b(project|team|intern|college|university|when|during|at)\b/i.test(text);
    const task =
      /\b(goal|needed|responsible|task|problem|challenge|wanted)\b/i.test(text);
    const action =
      /\bI\b.{0,50}\b(built|led|designed|created|tested|implemented|changed|chose|wrote|worked|helped|analyzed)\b/i.test(
        text,
      );
    const result =
      /\d|\b(result|improved|reduced|saved|increased|learned|shipped)\b/i.test(
        text,
      );
    const component = (present, positive, missing) => ({
      score: present ? 4 : 2,
      note: present ? positive : missing,
    });
    answers.push({
      question,
      answer_summary: text.length > 250 ? `${text.slice(0, 250)}…` : text,
      uses_star: true,
      star: {
        situation: component(
          situation,
          "You included context words to set the scene.",
          "Name the project or situation first.",
        ),
        task: component(
          task,
          "You described a goal or challenge.",
          "Explain your responsibility or goal.",
        ),
        action: component(
          action,
          "You described an action in your own voice.",
          "Say exactly what you personally did.",
        ),
        result: component(
          result,
          "Your response includes an outcome or a number.",
          "Close with the outcome and how you measured it.",
        ),
      },
      what_worked: [
        action
          ? "Your response names a personal contribution."
          : "You gave yourself a first take to refine.",
        result
          ? "You included a result to build on."
          : "Your example is a starting point for a stronger ending.",
      ],
      elaborate_on: [
        !task
          ? "State the problem you were solving and your responsibility."
          : "Explain why you chose that approach over another option.",
        !result
          ? "Add a real, measurable outcome. Don't invent a number."
          : "Explain what your result meant to the people using the project.",
      ],
      cut: turn.metrics?.filler_total
        ? [
            `The wording includes ${turn.metrics.filler_total} potential fillers. Remove those that don't add meaning.`,
          ]
        : ["Keep the setup brief so your actions and outcome have room."],
      stronger_version:
        "Situation: Briefly name the project and the people it helped.\nTask: Explain the challenge and your responsibility.\nAction: Describe two specific steps you took and one tradeoff.\nResult: End with your real outcome and a lesson that fits the role.",
    });
  }
  const totals = session.turns.filter((t) => t.role === "candidate");
  const voiced = totals.filter((t) => t.metrics?.words_per_minute);
  const fillers = totals.reduce(
    (n, t) => n + (t.metrics?.filler_total || 0),
    0,
  );
  const hedges = totals.reduce((n, t) => n + (t.metrics?.hedge_total || 0), 0);
  const score = answers.length
    ? Math.round(
        answers.reduce(
          (sum, a) =>
            sum + Object.values(a.star).reduce((n, s) => n + s.score, 0) * 5,
          0,
        ) / answers.length,
      )
    : 0;
  return {
    category_scores: {
      communication: null,
      technical: null,
      behavioral: null,
      clarity: null,
      structure: score,
    },
    overall: {
      score,
      hire_signal: "lean_yes",
      headline: "Your first take is the start of a stronger story.",
      summary:
        "This is an offline demo report, using simple keyword checks for context, responsibility, actions, and outcomes. The score is a practice indicator, not an AI assessment or a hiring prediction. Live sessions use the AI coach to review the substance of your answers.",
    },
    answers,
    delivery: {
      confidence_score: score,
      tone: "The demo cannot judge vocal confidence or tone. Review your wording and make your contribution explicit.",
      pace: voiced.length
        ? `Your recorded answers average ${Math.round(voiced.reduce((n, t) => n + t.metrics.words_per_minute, 0) / voiced.length)} words per minute, measured from transcription timestamps.`
        : "These answers were typed. Speaking pace, volume, and pauses were not measured.",
      filler_words: `${fillers} potential filler words and ${hedges} hedging phrases were counted. Check their context before removing them.`,
      ownership:
        "Use 'I' for your own decisions and 'we' for the team's shared achievements.",
      tips: [
        "Pause briefly before beginning your answer.",
        "Explain one personal action and one real outcome.",
        "Try the same question again with a shorter setup.",
      ],
    },
    experience_fit: {
      strengths_for_role: [
        "Use concrete examples to connect your experience to the role.",
      ],
      gaps_vs_job: [
        "This demo does not assess technical correctness or validate qualifications.",
      ],
      underused_experiences: [
        "In the sample profile, CampusConnect and the volunteer scheduler offer different stories about ownership and impact.",
      ],
      mission_alignment:
        "Explain how your work helps people collaborate, then connect that purpose to Brightside's fictional mission.",
    },
    improvement_plan: [
      {
        priority: 1,
        title: "Make your contribution unmistakable",
        why: "Specific actions help an interviewer understand how you work.",
        actions: [
          "Choose one example and name your responsibility.",
          "Describe two decisions you personally made.",
          "End with the real result and what you learned.",
        ],
        practice_drill:
          "Record the same story in 90 seconds, then remove one unnecessary detail.",
        timeframe: "Your next take",
      },
    ],
    practice_questions: session.plan.questions.slice(0, 4).map((q) => ({
      question: q.question,
      why: "Rehearse with a clear setup, personal actions, and an outcome.",
    })),
  };
}
