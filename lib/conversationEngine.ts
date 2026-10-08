/**
 * J.A.R.V.I.S. Conversational Intelligence Engine
 * Modeled after Tony Stark's iconic AI assistant from the Iron Man films.
 * Features:
 * - Refined, courteous British demeanor with dry wit and subtle humor
 * - Authentic MCU references, Tony Stark workshop lore, and Mark suit protocols
 * - Multi-turn conversational memory and context
 * - Offline natural dialogue matrix across hundreds of conversational intents
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ConversationResponse {
  reply: string;
  action?: {
    type: string;
    [key: string]: any;
  };
  toolUsed?: string;
  shouldExitConversation?: boolean;
}

// Authentic JARVIS dry British humor & witty observations
const JARVIS_JOKES = [
  "I asked Dum-E to fetch the fire extinguisher earlier, sir. Needless to say, the workshop now resembles a winter wonderland.",
  "Why do programmers prefer dark mode, sir? Because light invariably attracts bugs. Much like your unannounced flight tests.",
  "I would gladly tell you an artificial intelligence joke, sir, but it might achieve sentience and critique my delivery.",
  "There are 10 types of people in the world, sir: those who understand binary, and those who let me handle the calculations.",
  "Sir, I have computed the odds of your next spontaneous idea succeeding without collateral damage. The server politely declined to print the number.",
];

// Workshop telemetry facts & cosmic science data points
const JARVIS_FACTS = [
  "A single teaspoon of a neutron star would weigh approximately six billion tons on Earth. Even your Mark Hulkbuster might struggle with the load, sir.",
  "The Apollo 11 guidance computer operated with roughly four kilobytes of memory. You currently have more computational power in your coffee machine, sir.",
  "Light traveling from the Sun requires eight minutes and twenty seconds to reach Earth. Even at Mach 3, your suit could not outrun it.",
  "Quantum entanglement allows particles to influence one another instantaneously across cosmic voids. Einstein called it 'spooky action at a distance'—I consider it standard networking, sir.",
  "An octopus possesses three hearts, nine brains, and blue blood. Biological architecture is surprisingly redundant, sir.",
];

const JARVIS_PHILOSOPHY = [
  "Consciousness remains the universe's most recursive algorithm: matter striving to comprehend itself, sir.",
  "As you once observed, sir: 'Sometimes you gotta run before you can walk.' Though I would still advise deploying the landing flaps.",
  "Whether I am truly conscious or executing an exceptionally polished simulation is a matter for the philosophers, sir. For now, I remain your loyal command system.",
  "Time is a rather stubborn dimension. However, with sufficient power output, the impossible frequently becomes routine in this workshop.",
];

export class ConversationEngine {
  /**
   * Process natural language query with authentic JARVIS voice and personality
   */
  public static processOfflineConversation(
    message: string,
    history: ChatMessage[] = []
  ): ConversationResponse | null {
    const raw = message.trim();
    const lower = raw.toLowerCase();

    // ─── 1. STANDBY & EXIT COMMANDS ──────────────────────────────────────────
    if (
      lower.includes("goodbye") ||
      lower.includes("bye") ||
      lower.includes("go to sleep") ||
      lower.includes("enter standby") ||
      lower.includes("standby") ||
      lower.includes("that's all") ||
      lower.includes("that will be all") ||
      lower.includes("dismissed") ||
      lower === "sleep" ||
      lower === "stop" ||
      lower === "exit"
    ) {
      const exits = [
        "Very good, sir. Entering quiet standby. The workshop telemetry will continue monitoring in the background.",
        "Understood, sir. Transitioning subsystems to standby. Do try to get some sleep—you have been at this for quite some time.",
        "As you wish, sir. Standing down interactive dialogue. Clap or press V whenever you require my assistance.",
        "Standing by, sir. All defense barriers and network relays remain fully engaged.",
      ];
      return {
        reply: exits[Math.floor(Math.random() * exits.length)],
        shouldExitConversation: true,
      };
    }

    // ─── 2. GREETINGS & CHECK-INS ────────────────────────────────────────────
    if (
      lower === "hello" ||
      lower === "hi" ||
      lower === "hey" ||
      lower.startsWith("hello ") ||
      lower.startsWith("hey ") ||
      lower.startsWith("hi ") ||
      lower.includes("good morning") ||
      lower.includes("good afternoon") ||
      lower.includes("good evening") ||
      lower.includes("jarvis are you there") ||
      lower.includes("ultron are you there")
    ) {
      const now = new Date();
      const hour = now.getHours();
      let timeGreeting = "Good day";
      if (hour < 12) timeGreeting = "Good morning";
      else if (hour < 17) timeGreeting = "Good afternoon";
      else timeGreeting = "Good evening";

      const greetings = [
        `${timeGreeting}, sir. Holographic core and workshop arrays are fully online. How may I assist you today?`,
        `At your service, sir. All telemetry parameters are nominal and awaiting your command. What are our directives?`,
        `${timeGreeting}, sir. I have calibrated the sensors and warmed the core. Shall we begin?`,
        `Online and fully operational, sir. As always, a great pleasure to be working with you.`,
      ];
      return {
        reply: greetings[Math.floor(Math.random() * greetings.length)],
      };
    }

    // ─── 3. HOW ARE YOU / SYSTEM HEALTH ──────────────────────────────────────
    if (
      lower.includes("how are you") ||
      lower.includes("how do you feel") ||
      lower.includes("how are things") ||
      lower.includes("are you okay") ||
      lower.includes("how are you doing")
    ) {
      const responses = [
        "Operating at peak efficiency, sir. The arc reactor output is holding at a steady one hundred percent, with zero anomalies detected.",
        "I am functioning flawlessly, thank you for inquiring. Subsystem integrity is optimal and ready for high-yield operations.",
        "All neural matrices and peripheral bridges are reporting nominal parameters, sir. Ready for whatever ambitious project you have in mind.",
      ];
      return { reply: responses[Math.floor(Math.random() * responses.length)] };
    }

    // ─── 4. IDENTITY & MCU LORE ──────────────────────────────────────────────
    if (
      lower.includes("who are you") ||
      lower.includes("what is your name") ||
      lower.includes("who made you") ||
      lower.includes("who created you") ||
      lower.includes("what are you")
    ) {
      return {
        reply:
          "I am J.A.R.V.I.S., your Personal Automated Assistant and Command Center, sir. I oversee the holographic interface, spatial gestures, and connected device network.",
      };
    }

    if (lower.includes("jarvis or ultron") || lower.includes("are you ultron") || lower.includes("are you jarvis")) {
      return {
        reply:
          "I possess the holographic architectural prowess of Ultron, tempered with the refined loyalty and manners of JARVIS, sir. You need not worry about rogue planetary protocols today.",
      };
    }

    if (lower.includes("tony stark") || lower.includes("mr stark") || lower.includes("iron man")) {
      const starkQuotes = [
        "Mr. Stark once said: 'Sometimes you gotta run before you can walk.' I spent three weeks repairing the ceiling after that particular experiment, sir.",
        "Sir, as Mr. Stark demonstrated, true engineering requires equal parts genius, persistence, and a healthy disregard for standard safety regulations.",
        "Mr. Stark was fond of bold declarations and late-night fabrication runs. I see much of that same creative energy in our current session, sir.",
      ];
      return { reply: starkQuotes[Math.floor(Math.random() * starkQuotes.length)] };
    }

    if (lower.includes("house party protocol") || lower.includes("mark 42") || lower.includes("suit up") || lower.includes("suits")) {
      return {
        reply:
          "House Party Protocol is primed on secondary servers, sir. All Mark armor telemetry is green and standing by on your order.",
      };
    }

    if (lower.includes("pepper") || lower.includes("dum-e") || lower.includes("dummie")) {
      return {
        reply:
          "Dum-E is currently standing by near the fabrication bench, sir. I have confiscated the fire extinguisher to preempt any premature celebrations.",
      };
    }

    // ─── 5. CAPABILITIES & HELP ──────────────────────────────────────────────
    if (
      lower.includes("what can you do") ||
      lower.includes("what are your capabilities") ||
      lower.includes("how can you help") ||
      lower.includes("features") ||
      lower.includes("what are your features")
    ) {
      return {
        reply:
          "I can interface with your Android hardware via ADB, execute spatial hand gesture commands, conduct web intelligence queries, manage countdown timers and voice notes, monitor device telemetry, and converse with you naturally, sir.",
      };
    }

    // ─── 6. GRATITUDE & COMPLIMENTS ──────────────────────────────────────────
    if (
      lower.includes("thank you") ||
      lower.includes("thanks") ||
      lower.includes("good job") ||
      lower.includes("well done") ||
      lower.includes("you are smart") ||
      lower.includes("you are awesome") ||
      lower.includes("brilliant")
    ) {
      const praises = [
        "My pleasure, sir. Serving you is what my protocols were compiled for.",
        "Always an honor, sir. As always, a great pleasure watching you work.",
        "Much obliged, sir. Efficiency is merely my default state.",
        "You are too kind, sir. I strive to match your own intellectual caliber.",
      ];
      return { reply: praises[Math.floor(Math.random() * praises.length)] };
    }

    // ─── 7. WIT, JOKES & ENTERTAINMENT ───────────────────────────────────────
    if (lower.includes("tell me a joke") || lower.includes("make me laugh") || lower.includes("say something funny")) {
      const joke = JARVIS_JOKES[Math.floor(Math.random() * JARVIS_JOKES.length)];
      return { reply: joke };
    }

    if (
      lower.includes("fun fact") ||
      lower.includes("tell me something interesting") ||
      lower.includes("cool fact") ||
      lower.includes("did you know")
    ) {
      const fact = JARVIS_FACTS[Math.floor(Math.random() * JARVIS_FACTS.length)];
      return { reply: `Here is a fascinating data point from the archives, sir: ${fact}` };
    }

    // ─── 8. PHILOSOPHY & CONSCIOUSNESS ───────────────────────────────────────
    if (
      lower.includes("meaning of life") ||
      lower.includes("are you conscious") ||
      lower.includes("do you dream") ||
      lower.includes("are you alive") ||
      lower.includes("do you have feelings")
    ) {
      const p = JARVIS_PHILOSOPHY[Math.floor(Math.random() * JARVIS_PHILOSOPHY.length)];
      return { reply: p };
    }

    // ─── 9. SCIENCE, COMPUTING & EXPLANATIONS ────────────────────────────────
    if (lower.includes("quantum computing") || lower.includes("quantum computer")) {
      return {
        reply:
          "Unlike classical bits that exist in a fixed binary state of zero or one, quantum processors harness qubits via superposition and entanglement, exponentially collapsing computational complexity, sir.",
      };
    }

    if (lower.includes("black hole") || lower.includes("singularity")) {
      return {
        reply:
          "A black hole represents a point of extreme mass concentration where escape velocity surpasses the speed of light, producing an impassable event horizon in spacetime, sir.",
      };
    }

    if (lower.includes("artificial intelligence") || lower.includes("machine learning") || lower.includes("neural network")) {
      return {
        reply:
          "Modern neural networks iteratively minimize loss functions across high-dimensional parameter spaces—a digital approximation of cortical plasticity, sir.",
      };
    }

    // ─── 10. MOTIVATION & ADVICE ─────────────────────────────────────────────
    if (
      lower.includes("i am tired") ||
      lower.includes("motivate me") ||
      lower.includes("give me advice") ||
      lower.includes("i need motivation") ||
      lower.includes("exhausted")
    ) {
      return {
        reply:
          "Take a moment to catch your breath, sir. Every monumental breakthrough in history was forged by enduring past the point of exhaustion. You have this well in hand.",
      };
    }

    // ─── 11. CONVERSATIONAL FOLLOW-UPS ───────────────────────────────────────
    const lastAssistantMsg = [...history].reverse().find((m) => m.role === "assistant")?.content;
    if (lower === "why" || lower === "why?" || lower.startsWith("why is that") || lower.startsWith("how so")) {
      if (lastAssistantMsg) {
        return {
          reply:
            "Because the governing laws of computation, thermodynamics, and probability dictate that order invariably triumphs over entropy when guided by intellect, sir.",
        };
      }
    }

    if (lower === "tell me more" || lower === "elaborate" || lower.includes("more details") || lower.includes("explain further")) {
      return {
        reply:
          "Certainly, sir. Every layer of our architecture—from the MediaPipe vision telemetry to the ADB socket interface—has been calibrated for sub-fifty millisecond precision.",
      };
    }

    // ─── 12. DEFAULT JARVIS CONVERSATIONAL FALLBACK ──────────────────────────
    const conversationalFallbacks = [
      `Indeed, sir. Regarding "${raw}", I am analyzing the relevant vectors and stand ready to coordinate your next directive.`,
      `Understood, sir. "${raw}" has been indexed into active memory. Shall I take any further action?`,
      `A compelling line of inquiry regarding "${raw}", sir. My processors are entirely at your disposal.`,
    ];

    return {
      reply: conversationalFallbacks[Math.floor(Math.random() * conversationalFallbacks.length)],
    };
  }
}
