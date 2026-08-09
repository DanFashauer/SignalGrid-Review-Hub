package com.signalgrid.assist

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.signalgrid.assist.core.Assist
import com.signalgrid.assist.core.AssistDecision
import com.signalgrid.assist.core.AssistWire

/**
 * The shell. It renders a decision; it does not make one and does not interpret one.
 *
 * Every judgement shown here comes from `:assist-core`, which is tested without an
 * emulator. If a rule about what a worker may do ever appears in this file, it has
 * escaped its coverage — treat that as the defect, not as a shortcut.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    // A fixture decision until the transport lands. Labelled as such
                    // rather than dressed up as a live result — a demo that cannot be
                    // told apart from the real thing is how a claim gets overstated.
                    DecisionScreen(
                        decision = AssistWire.parse(
                            200,
                            """{"assist":"step_up","reasons":["fixture: no gate configured"],"obligations":["webauthn"]}""",
                        ),
                        live = false,
                    )
                }
            }
        }
    }
}

@Composable
fun DecisionScreen(decision: AssistDecision, live: Boolean) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = when (decision.assist) {
                Assist.ALLOW -> "Allowed"
                Assist.STEP_UP -> "Additional verification required"
                Assist.RESTRICT -> "Limited access"
                Assist.DENY -> "Not allowed"
            },
            style = MaterialTheme.typography.headlineSmall,
        )

        // The reason, always. `explanation()` reports absence rather than inventing
        // reassurance, so a worker is never told "contact your administrator" with
        // nothing an administrator could act on.
        Text(text = decision.explanation(), style = MaterialTheme.typography.bodyMedium)

        if (decision.obligations.isNotEmpty()) {
            Text(
                text = "Required: " + decision.obligations.joinToString(", "),
                style = MaterialTheme.typography.bodySmall,
            )
        }

        if (!live) {
            Text(
                text = "FIXTURE — not a live decision. No gate is configured.",
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
