package com.signalgrid.assist

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.signalgrid.assist.core.Assist
import com.signalgrid.assist.core.AssistDecision
import com.signalgrid.assist.core.AssistWire
import com.signalgrid.assist.core.GateEndpoint

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
        // No gate URL is configured anywhere in this build, so this is always a
        // refusal — shown, not hidden, because "no gate is configured" is a fact
        // worth stating. The endpoint is built by DeviceGate so the emulator-only
        // loopback exception is decided in exactly one place.
        val gate = DeviceGate.endpoint().validate(null)
        setContent {
            // Follows the device, like the window theme in res/values{,-night}. A
            // fixed light scheme over a dark window is the defect the iOS lane
            // already paid for once.
            val dark = isSystemInDarkTheme()
            MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    // A fixture decision until the transport lands. Labelled as such
                    // rather than dressed up as a live result — a demo that cannot be
                    // told apart from the real thing is how a claim gets overstated.
                    //
                    // Shaped like the SERVED wire: /api/v1/authorize answers
                    // {assist, decisionId, reasons} (lib/api-spec/v1-openapi.yaml,
                    // AssistResult) and declares no obligations field. The earlier
                    // fixture carried "obligations":["webauthn"], a shape no server
                    // sends, which hid the case that matters below.
                    DecisionScreen(
                        decision = AssistWire.parse(
                            200,
                            """{"assist":"step_up","decisionId":"dec_fixture_0001","reasons":["fixture: no gate configured"]}""",
                        ),
                        live = false,
                        gateNote = when (gate) {
                            is GateEndpoint.Result.Usable -> "Gate: ${gate.baseUrl} (validated only; this build never contacts it)"
                            is GateEndpoint.Result.Refused -> "Gate: ${gate.reason}"
                        },
                    )
                }
            }
        }
    }
}

@Composable
fun DecisionScreen(decision: AssistDecision, live: Boolean, gateNote: String) {
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

        // `obligations` is optional-absent on the wire and absent is the served
        // case. Absent means "not stated", never "nothing required": a step_up with
        // no obligation listed still does not proceed, and the screen says which of
        // the two it is rather than leaving a blank that reads as done.
        if (decision.obligations.isNotEmpty()) {
            Text(
                text = "Required: " + decision.obligations.joinToString(", "),
                style = MaterialTheme.typography.bodySmall,
            )
        } else if (decision.assist == Assist.STEP_UP) {
            Text(
                text = "Step up required; the gate did not state an obligation.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Text(text = gateNote, style = MaterialTheme.typography.bodySmall)

        if (!live) {
            Text(
                text = "FIXTURE — not a live decision. No gate is configured.",
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
