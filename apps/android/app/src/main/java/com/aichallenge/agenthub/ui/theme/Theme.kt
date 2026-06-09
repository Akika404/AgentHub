package com.aichallenge.agenthub.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

private val ColorDarkBackground = androidx.compose.ui.graphics.Color(0xFF15171A)
private val ColorDarkSurface = androidx.compose.ui.graphics.Color(0xFF1D2024)
private val ColorDarkSurfaceVariant = androidx.compose.ui.graphics.Color(0xFF252A30)
private val ColorDarkBorder = androidx.compose.ui.graphics.Color(0xFF363C44)
private val ColorDarkTextMain = androidx.compose.ui.graphics.Color(0xFFECEFF3)
private val ColorDarkTextMuted = androidx.compose.ui.graphics.Color(0xFF9EA6B1)
private val ColorDarkBlueContainer = androidx.compose.ui.graphics.Color(0xFF1B3268)
private val ColorDarkAccentContainer = androidx.compose.ui.graphics.Color(0xFF312B66)
private val ColorDarkDangerContainer = androidx.compose.ui.graphics.Color(0xFF4A1E24)

private val DarkColorScheme = darkColorScheme(
    primary = AgentBlue,
    onPrimary = AgentSurface,
    primaryContainer = ColorDarkBlueContainer,
    onPrimaryContainer = AgentBlueSofter,
    secondary = AgentTextMuted,
    onSecondary = AgentSurface,
    secondaryContainer = ColorDarkSurfaceVariant,
    onSecondaryContainer = ColorDarkTextMain,
    tertiary = AgentAccent,
    tertiaryContainer = ColorDarkAccentContainer,
    onTertiaryContainer = AgentAccentSoft,
    background = ColorDarkBackground,
    onBackground = ColorDarkTextMain,
    surface = ColorDarkSurface,
    onSurface = ColorDarkTextMain,
    surfaceVariant = ColorDarkSurfaceVariant,
    onSurfaceVariant = ColorDarkTextMuted,
    outline = ColorDarkBorder,
    outlineVariant = ColorDarkBorder,
    error = AgentDanger,
    errorContainer = ColorDarkDangerContainer,
    onErrorContainer = AgentDangerSoft
)

private val LightColorScheme = lightColorScheme(
    primary = AgentBlue,
    onPrimary = AgentSurface,
    primaryContainer = AgentBlueSoft,
    onPrimaryContainer = AgentBlue,
    secondary = AgentTextSecondary,
    onSecondary = AgentSurface,
    secondaryContainer = AgentSurfaceHover,
    onSecondaryContainer = AgentTextMain,
    tertiary = AgentAccent,
    tertiaryContainer = AgentAccentSoft,
    onTertiaryContainer = AgentAccent,
    background = AgentBackground,
    onBackground = AgentTextMain,
    surface = AgentSurface,
    onSurface = AgentTextMain,
    surfaceVariant = AgentSurfaceHover,
    onSurfaceVariant = AgentTextMuted,
    outline = AgentSurfaceBorder,
    outlineVariant = AgentSurfaceBorder,
    error = AgentDanger,
    errorContainer = AgentDangerSoft,
    onErrorContainer = AgentDanger

    /* Other default colors to override
    background = Color(0xFFFFFBFE),
    surface = Color(0xFFFFFBFE),
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = Color.White,
    onBackground = Color(0xFF1C1B1F),
    onSurface = Color(0xFF1C1B1F),
    */
)

private val AgentShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(10.dp),
    extraLarge = RoundedCornerShape(12.dp)
)

@Composable
fun AgentHubTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        darkTheme && dynamicColor -> DarkColorScheme
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = AgentShapes,
        content = content
    )
}
