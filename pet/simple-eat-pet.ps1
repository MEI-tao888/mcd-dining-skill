$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

Add-Type -Namespace SimpleEat -Name Native -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
"@

$root = $PSScriptRoot
$cfg = @{
    workbuddyExe = 'D:\LenovoSoftstore\Install\WorkBuddy\WorkBuddy.exe'
    projectPath  = (Split-Path -Parent (Split-Path -Parent $root))
    startPrompt  = '用简单麦。现在开始，午饭吃啥？'
    bubbleText   = '今天想麦什么'
}
foreach ($name in 'config.json', 'config.example.json') {
    $configFile = Join-Path $root $name
    if (Test-Path -LiteralPath $configFile) {
        $json = [IO.File]::ReadAllText($configFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
        foreach ($prop in $json.PSObject.Properties) {
            if ($prop.Value) { $cfg[$prop.Name] = [string]$prop.Value }
        }
        break
    }
}

$brushConverter = New-Object System.Windows.Media.BrushConverter
function Get-Brush($hex) { $brushConverter.ConvertFromString($hex) }

$cellSize = 6
$gridWidth = 24
$gridHeight = 28

function ConvertTo-PixelColor($hex) {
    $color = [System.Windows.Media.ColorConverter]::ConvertFromString($hex)
    , [byte[]]@($color.B, $color.G, $color.R, 255)
}

$palette = @{
    K = ConvertTo-PixelColor '#3A2018'
    R = ConvertTo-PixelColor '#D9342B'
    Y = ConvertTo-PixelColor '#F7C948'
    C = ConvertTo-PixelColor '#FFF4DE'
    P = ConvertTo-PixelColor '#F27B63'
}

function New-Piece($col, $row, $rows) { @{ Col = $col; Row = $row; Rows = $rows } }

function New-LayerBitmap($pieces) {
    $pixels = New-Object byte[] ($gridWidth * $gridHeight * 4)
    foreach ($piece in $pieces) {
        for ($rowIndex = 0; $rowIndex -lt $piece.Rows.Count; $rowIndex++) {
            $line = $piece.Rows[$rowIndex]
            for ($colIndex = 0; $colIndex -lt $line.Length; $colIndex++) {
                $key = [string]$line[$colIndex]
                if (-not $palette.ContainsKey($key)) { continue }
                $targetCol = $piece.Col + $colIndex
                $targetRow = $piece.Row + $rowIndex
                if ($targetCol -ge $gridWidth -or $targetRow -ge $gridHeight) {
                    throw "Pixel out of range: $targetCol,$targetRow"
                }
                $offset = ($targetRow * $gridWidth + $targetCol) * 4
                [Array]::Copy($palette[$key], 0, $pixels, $offset, 4)
            }
        }
    }
    $bitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap($gridWidth, $gridHeight, 96, 96, [System.Windows.Media.PixelFormats]::Bgra32, $null)
    $bitmap.WritePixels([System.Windows.Int32Rect]::new(0, 0, $gridWidth, $gridHeight), $pixels, $gridWidth * 4, 0)
    $bitmap.Freeze()
    $bitmap
}

function New-LayerImage($bitmap) {
    $image = New-Object System.Windows.Controls.Image
    $image.Width = $gridWidth * $cellSize
    $image.Height = $gridHeight * $cellSize
    $image.Stretch = 'Fill'
    $image.Source = $bitmap
    $image.IsHitTestVisible = $false
    [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($image, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
    $image
}

$friesRows = @(
    '............KKKK........',
    '.........KKKKYYK........',
    '.........KYYKYYKKKK.....',
    '......KKKKYYKYYKYYK.....',
    '......KYYKYYKYYKYYK.....',
    '......KYYKYYKYYKYYK.....',
    '......KYYKYYKYYKYYK.....',
    '......KYYKYYKYYKYYK.....'
)

$plainRow = '..K' + ('R' * 18) + 'K..'
$blushRow = '..K' + 'R' + 'PP' + ('R' * 12) + 'PP' + 'R' + 'K..'
$creamRow = '..K' + ('C' * 18) + 'K..'
$bodyRows = @(
    (('.' * 5) + ('K' * 14) + ('.' * 5)),
    '...KKRRRCCRRRRRCCRRKK...',
    $plainRow, $plainRow, $plainRow, $plainRow, $plainRow, $plainRow,
    $blushRow, $blushRow,
    $plainRow, $plainRow,
    $creamRow, $creamRow,
    ('..K' + ('Y' * 18) + 'K..'),
    ('...K' + ('Y' * 16) + 'K...'),
    (('.' * 4) + ('K' * 16) + ('.' * 4))
)

$handRows = @('.KK.', 'KCCK', 'KCCK', '.KK.')
$footRows = @('KCCCCK', 'KCCCCK', '.KKKK.')
$heartRows = @('.K.K.', 'KRKRK', 'KRRRK', '.KRK.', '..K..')

$eyeOpen = @('.KK.', 'CCKK', 'CCKK', 'KKKK', 'KKKC', '.KK.')
$eyeBlink = @('KKKK')
$eyeHappy = @('.KK.', 'K..K')
$mouthSmile = @('K..K', '.KK.')
$mouthOpen = @('KKKK', 'KPPK', '.KK.')

$frames = @{
    open      = New-LayerBitmap @((New-Piece 6 11 $eyeOpen), (New-Piece 14 11 $eyeOpen), (New-Piece 10 18 $mouthSmile))
    lookLeft  = New-LayerBitmap @((New-Piece 5 11 $eyeOpen), (New-Piece 13 11 $eyeOpen), (New-Piece 10 18 $mouthSmile))
    lookRight = New-LayerBitmap @((New-Piece 7 11 $eyeOpen), (New-Piece 15 11 $eyeOpen), (New-Piece 10 18 $mouthSmile))
    blink     = New-LayerBitmap @((New-Piece 6 14 $eyeBlink), (New-Piece 14 14 $eyeBlink), (New-Piece 10 18 $mouthSmile))
    happy     = New-LayerBitmap @((New-Piece 6 13 $eyeHappy), (New-Piece 14 13 $eyeHappy), (New-Piece 10 18 $mouthOpen))
}

$friesImage = New-LayerImage (New-LayerBitmap @((New-Piece 0 0 $friesRows)))
$bodyImage = New-LayerImage (New-LayerBitmap @((New-Piece 0 8 $bodyRows)))
$leftHandImage = New-LayerImage (New-LayerBitmap @((New-Piece 0 14 $handRows)))
$rightHandImage = New-LayerImage (New-LayerBitmap @((New-Piece 20 14 $handRows)))
$leftFootImage = New-LayerImage (New-LayerBitmap @((New-Piece 5 25 $footRows)))
$rightFootImage = New-LayerImage (New-LayerBitmap @((New-Piece 13 25 $footRows)))
$faceImage = New-LayerImage $frames.open
$heartImage = New-LayerImage (New-LayerBitmap @((New-Piece 19 0 $heartRows)))
$heartImage.Visibility = 'Collapsed'

$friesRotate = New-Object System.Windows.Media.RotateTransform -ArgumentList 0, 72, 48
$friesImage.RenderTransform = $friesRotate
$leftHandShift = New-Object System.Windows.Media.TranslateTransform
$rightHandShift = New-Object System.Windows.Media.TranslateTransform
$leftFootShift = New-Object System.Windows.Media.TranslateTransform
$rightFootShift = New-Object System.Windows.Media.TranslateTransform
$heartShift = New-Object System.Windows.Media.TranslateTransform
$leftHandImage.RenderTransform = $leftHandShift
$rightHandImage.RenderTransform = $rightHandShift
$leftFootImage.RenderTransform = $leftFootShift
$rightFootImage.RenderTransform = $rightFootShift
$heartImage.RenderTransform = $heartShift

$petScale = New-Object System.Windows.Media.ScaleTransform
$petShift = New-Object System.Windows.Media.TranslateTransform
$petTransform = New-Object System.Windows.Media.TransformGroup
[void]$petTransform.Children.Add($petScale)
[void]$petTransform.Children.Add($petShift)

$petGrid = New-Object System.Windows.Controls.Grid
$petGrid.Width = $gridWidth * $cellSize
$petGrid.Height = $gridHeight * $cellSize
$petGrid.HorizontalAlignment = 'Center'
$petGrid.VerticalAlignment = 'Bottom'
$petGrid.Margin = [System.Windows.Thickness]::new(0, 0, 0, 6)
$petGrid.RenderTransformOrigin = [System.Windows.Point]::new(0.5, 1)
$petGrid.RenderTransform = $petTransform
foreach ($layer in $leftFootImage, $rightFootImage, $friesImage, $bodyImage, $leftHandImage, $rightHandImage, $faceImage, $heartImage) {
    [void]$petGrid.Children.Add($layer)
}

$bubbleLabel = New-Object System.Windows.Controls.TextBlock
$bubbleLabel.Text = $cfg.bubbleText
$bubbleLabel.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
$bubbleLabel.FontSize = 15
$bubbleLabel.FontWeight = 'Bold'
$bubbleLabel.Foreground = Get-Brush '#3A2018'
$bubbleLabel.TextAlignment = 'Center'
$bubbleLabel.VerticalAlignment = 'Center'
$bubbleLabel.HorizontalAlignment = 'Center'
$bubbleLabel.TextWrapping = 'NoWrap'

$bubbleBody = New-Object System.Windows.Controls.Border
$bubbleBody.Width = 164
$bubbleBody.Height = 34
$bubbleBody.ClipToBounds = $true
$bubbleBody.Padding = [System.Windows.Thickness]::new(8, 4, 8, 4)
$bubbleBody.BorderThickness = [System.Windows.Thickness]::new(3)
$bubbleBody.BorderBrush = Get-Brush '#3A2018'
$bubbleBody.Background = Get-Brush '#FFF4DE'
$bubbleBody.Child = $bubbleLabel

$bubbleTail = New-Object System.Windows.Shapes.Path
$bubbleTail.Data = [System.Windows.Media.Geometry]::Parse('M 0,0 L 8,8 L 16,0')
$bubbleTail.Fill = Get-Brush '#FFF4DE'
$bubbleTail.Stroke = Get-Brush '#3A2018'
$bubbleTail.StrokeThickness = 3
$bubbleTail.HorizontalAlignment = 'Center'
$bubbleTail.Margin = [System.Windows.Thickness]::new(0, -3, 0, 0)

$bubbleScale = New-Object System.Windows.Media.ScaleTransform
$bubbleHost = New-Object System.Windows.Controls.StackPanel
$bubbleHost.VerticalAlignment = 'Top'
$bubbleHost.HorizontalAlignment = 'Center'
$bubbleHost.Margin = [System.Windows.Thickness]::new(0, 4, 0, 0)
$bubbleHost.Opacity = 0
$bubbleHost.IsHitTestVisible = $false
$bubbleHost.RenderTransformOrigin = [System.Windows.Point]::new(0.5, 1)
$bubbleHost.RenderTransform = $bubbleScale
[void]$bubbleHost.Children.Add($bubbleBody)
[void]$bubbleHost.Children.Add($bubbleTail)

$layout = New-Object System.Windows.Controls.Grid
$layout.Background = Get-Brush '#01000000'
$layout.SnapsToDevicePixels = $true
$layout.UseLayoutRounding = $true
[void]$layout.RowDefinitions.Add([System.Windows.Controls.RowDefinition]@{ Height = [System.Windows.GridLength]::Auto })
[void]$layout.RowDefinitions.Add([System.Windows.Controls.RowDefinition]@{ Height = [System.Windows.GridLength]::new(1, 'Star') })
[System.Windows.Controls.Grid]::SetRow($bubbleHost, 1)
[System.Windows.Controls.Grid]::SetRow($petGrid, 1)
[void]$layout.Children.Add($petGrid)
[void]$layout.Children.Add($bubbleHost)

$random = New-Object System.Random
$bobTable = @(0, 3)
$hoverTable = @(0, -4, -8, -10, -8, -4, 0, 0)
$swayTable = @(0, 2, 3, 4, 3, 2, 0, -2, -3, -4, -3, -2)
$tapTable = @(0, -6, -6, 0, -6, -6, 0)
$clickTable = @(
    @(1.14, 0.84, 0),
    @(1.16, 0.80, 0),
    @(0.92, 1.12, -8),
    @(0.92, 1.14, -16),
    @(0.96, 1.08, -20),
    @(1.0, 1.0, -16),
    @(1.0, 1.0, -8),
    @(1.08, 0.90, 0),
    @(1.04, 0.96, 0),
    @(1.0, 1.0, 0)
)

$state = @{
    Tick = 0; Hover = $false; Dragging = $false
    ClickStep = -1; HeartStep = -1; TapStep = -1
    TipTicks = 0; TipText = ''; BubbleKey = 'default'
    BlinkIn = 30; BlinkLeft = 0
    LookIn = 90; LookLeft = 0; LookDir = 0
    TapIn = 110; SuccessTicks = 0; BubbleLevel = 0.0; Frame = 'open'
}

function Show-Tip($message) {
    $state.TipText = $message
    $state.TipTicks = 42
}

$bubbleMaxWidth = 172
$bubbleChromeWidth = 22
$bubbleChromeHeight = 14
$bubbleMinHeight = 34
$bubbleResizeMs = 220

function Get-BubbleLayout($text, $fontSize) {
    $probe = New-Object System.Windows.Controls.TextBlock
    $probe.Text = $text
    $probe.FontFamily = $bubbleLabel.FontFamily
    $probe.FontSize = $fontSize
    $probe.FontWeight = $bubbleLabel.FontWeight
    $unbounded = [double]::PositiveInfinity
    $labelLimit = $bubbleMaxWidth - $bubbleChromeWidth
    $probe.Measure([System.Windows.Size]::new($unbounded, $unbounded))
    $wrap = 'NoWrap'
    if ($probe.DesiredSize.Width -gt $labelLimit) {
        $wrap = 'Wrap'
        $probe.TextWrapping = 'Wrap'
        $probe.Measure([System.Windows.Size]::new($labelLimit, $unbounded))
    }
    $labelWidth = [Math]::Min($labelLimit, [Math]::Ceiling($probe.DesiredSize.Width) + 2)
    @{
        Wrap       = $wrap
        LabelWidth = $labelWidth
        Width      = $labelWidth + $bubbleChromeWidth
        Height     = [Math]::Max($bubbleMinHeight, [Math]::Ceiling($probe.DesiredSize.Height) + $bubbleChromeHeight)
    }
}

function Set-BubbleLabel($text, $fontSize, $metrics) {
    $bubbleLabel.Text = $text
    $bubbleLabel.FontSize = $fontSize
    $bubbleLabel.TextWrapping = $metrics.Wrap
    $bubbleLabel.Width = $metrics.LabelWidth
}

function Start-BubbleResize($width, $height) {
    $ease = New-Object System.Windows.Media.Animation.CubicEase
    $ease.EasingMode = 'EaseOut'
    $duration = New-Object System.Windows.Duration -ArgumentList ([TimeSpan]::FromMilliseconds($bubbleResizeMs))
    $targets = @(
        @([System.Windows.FrameworkElement]::WidthProperty, [double]$width),
        @([System.Windows.FrameworkElement]::HeightProperty, [double]$height)
    )
    foreach ($target in $targets) {
        $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
        $animation.To = $target[1]
        $animation.Duration = $duration
        $animation.EasingFunction = $ease
        $bubbleBody.BeginAnimation($target[0], $animation)
    }
}

function Reset-Bubble {
    $bubbleBody.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $null)
    $bubbleBody.BeginAnimation([System.Windows.FrameworkElement]::HeightProperty, $null)
    $bubbleBody.Width = $defaultBubble.Width
    $bubbleBody.Height = $defaultBubble.Height
    Set-BubbleLabel $cfg.bubbleText 15.0 $defaultBubble
    $state.BubbleKey = 'default'
}

function Update-BubbleContent($tipActive) {
    if ($tipActive) { $wantedKey = 'tip:' + $state.TipText }
    elseif ($state.Hover) { $wantedKey = 'default' }
    else { $wantedKey = '' }

    if ($wantedKey) {
        if ($wantedKey -ne $state.BubbleKey) {
            if ($tipActive) {
                $metrics = Get-BubbleLayout $state.TipText 12.0
                Set-BubbleLabel $state.TipText 12.0 $metrics
            } else {
                $metrics = $defaultBubble
                Set-BubbleLabel $cfg.bubbleText 15.0 $metrics
            }
            Start-BubbleResize $metrics.Width $metrics.Height
            $state.BubbleKey = $wantedKey
        }
    } elseif ($state.BubbleLevel -le 0) {
        if ($state.BubbleKey -ne 'default') { Reset-Bubble }
    } elseif ($state.BubbleKey -like 'tip:*') {
        Start-BubbleResize $defaultBubble.Width $defaultBubble.Height
        $state.BubbleKey = 'retract'
    }
}

$defaultBubble = Get-BubbleLayout $cfg.bubbleText 15.0
Reset-Bubble

function Update-Pet {
    $state.Tick++
    $step = $state.Tick

    $shiftY = $bobTable[([int][Math]::Floor($step / 8)) % 2]
    $scaleX = 1.0
    $scaleY = 1.0
    if ($state.Hover) { $shiftY = $hoverTable[$step % $hoverTable.Count] }
    if ($state.Dragging) { $shiftY = -4 }
    $clickActive = $state.ClickStep -ge 0
    $successActive = $state.SuccessTicks -gt 0
    if ($successActive) {
        $successTable = @(0, -4, -8, -10, -8, -4, 0, 0, -4, -8, -4, 0)
        $shiftY = $successTable[([int][Math]::Floor(($step % 72) / 6))]
        $state.SuccessTicks--
    }
    if ($clickActive) {
        $clickFrame = $clickTable[$state.ClickStep]
        $scaleX = $clickFrame[0]
        $scaleY = $clickFrame[1]
        $shiftY = $clickFrame[2]
        $state.ClickStep++
        if ($state.ClickStep -ge $clickTable.Count) { $state.ClickStep = -1 }
    }
    $petScale.ScaleX = $scaleX
    $petScale.ScaleY = $scaleY
    $petShift.Y = $shiftY

    if ($state.Hover) {
        $swayAngle = 1.5 * $swayTable[([int][Math]::Floor($step / 2)) % $swayTable.Count]
    } else {
        $swayAngle = $swayTable[([int][Math]::Floor($step / 3)) % $swayTable.Count]
    }
    $friesRotate.Angle = $swayAngle

    $leftHandY = 0
    $rightHandY = 0
    $leftFootY = 0
    $rightFootY = 0
    $wavePhase = ([int][Math]::Floor($step / 3)) % 2
    if ($state.Dragging) {
        $leftHandY = -14
        $rightHandY = -14
        if ($wavePhase -eq 0) { $leftFootY = -6 } else { $rightFootY = -6 }
    } else {
        if ($state.Hover) {
            if ($wavePhase -eq 0) { $leftHandY = -12; $rightHandY = -4 } else { $leftHandY = -4; $rightHandY = -12 }
        }
        if ($state.TapStep -ge 0) {
            $leftFootY = $tapTable[$state.TapStep]
            $state.TapStep++
            if ($state.TapStep -ge $tapTable.Count) { $state.TapStep = -1 }
        } else {
            $state.TapIn--
            if ($state.TapIn -le 0) {
                $state.TapStep = 0
                $state.TapIn = $random.Next(90, 200)
            }
        }
    }
    $leftHandShift.Y = $leftHandY
    $rightHandShift.Y = $rightHandY
    $leftFootShift.Y = $leftFootY
    $rightFootShift.Y = $rightFootY

    $state.BlinkIn--
    if ($state.BlinkIn -le 0) {
        $state.BlinkLeft = 3
        if ($random.Next(0, 4) -eq 0) { $state.BlinkIn = 6 } else { $state.BlinkIn = $random.Next(35, 85) }
    }
    $state.LookIn--
    if ($state.LookIn -le 0) {
        $state.LookLeft = 14
        $state.LookDir = $random.Next(0, 2) * 2 - 1
        $state.LookIn = $random.Next(90, 200)
    }

    $tipActive = $state.TipTicks -gt 0
    if ($tipActive) { $state.TipTicks-- }

    if ($state.Hover -or $state.Dragging -or $tipActive -or $clickActive -or $successActive) {
        $frameName = 'happy'
    } elseif ($state.BlinkLeft -gt 0) {
        $frameName = 'blink'
        $state.BlinkLeft--
    } elseif ($state.LookLeft -gt 0) {
        if ($state.LookDir -lt 0) { $frameName = 'lookLeft' } else { $frameName = 'lookRight' }
        $state.LookLeft--
    } else {
        $frameName = 'open'
    }
    if ($state.Frame -ne $frameName) {
        $faceImage.Source = $frames[$frameName]
        $state.Frame = $frameName
    }

    if ($state.HeartStep -ge 0) {
        $heartShift.Y = -3 * $state.HeartStep
        if ($state.HeartStep -lt 8) { $heartImage.Opacity = 1.0 } else { $heartImage.Opacity = [Math]::Max(0.0, (12 - $state.HeartStep) / 4.0) }
        $heartImage.Visibility = 'Visible'
        $state.HeartStep++
        if ($state.HeartStep -ge 12) {
            $state.HeartStep = -1
            $heartImage.Visibility = 'Collapsed'
        }
    }

    Update-BubbleContent $tipActive
    if ($state.Hover -or $tipActive) {
        $state.BubbleLevel = [Math]::Min(1.0, $state.BubbleLevel + 0.34)
    } else {
        $state.BubbleLevel = [Math]::Max(0.0, $state.BubbleLevel - 0.34)
    }
    $bubbleHost.Opacity = $state.BubbleLevel
    $bubbleScale.ScaleX = 0.8 + 0.2 * $state.BubbleLevel
    $bubbleScale.ScaleY = 0.8 + 0.2 * $state.BubbleLevel
}

$window = New-Object System.Windows.Window
$window.Title = '小简'
$window.Width = 180
$window.Height = 220
$window.WindowStyle = 'None'
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ResizeMode = 'NoResize'
$window.Content = $layout
$workArea = [System.Windows.SystemParameters]::WorkArea
$window.WindowStartupLocation = 'Manual'
$window.Left = $workArea.Right - 200
$window.Top = $workArea.Bottom - 240

function Copy-Prompt {
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
        try {
            [System.Windows.Clipboard]::SetDataObject($cfg.startPrompt, $true)
            return $true
        } catch {
            Start-Sleep -Milliseconds 60
        }
    }
    try { Set-Clipboard -Value $cfg.startPrompt; return $true } catch { return $false }
}

function Open-WorkBuddy {
    $processName = [IO.Path]::GetFileNameWithoutExtension($cfg.workbuddyExe)
    $running = Get-Process -Name $processName -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
        Select-Object -First 1
    if ($running) {
        $handle = $running.MainWindowHandle
        if ([SimpleEat.Native]::IsIconic($handle)) { [void][SimpleEat.Native]::ShowWindow($handle, 9) }
        [void][SimpleEat.Native]::SetForegroundWindow($handle)
        return $true
    }
    if (Test-Path -LiteralPath $cfg.workbuddyExe) {
        Start-Process -FilePath $cfg.workbuddyExe
        return $true
    }
    return $false
}


$script:onboardingWindow = $null
$script:onboarding = @{}
$script:onboardingClosing = $false
$script:onboardingPath = Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EasyEat') 'onboarding.json'

function Get-OnboardingSeen {
    try {
        if (-not (Test-Path -LiteralPath $script:onboardingPath)) { return $false }
        $record = Get-Content -LiteralPath $script:onboardingPath -Raw -ErrorAction Stop | ConvertFrom-Json
        return [bool]$record.seen
    } catch { return $false }
}

function Set-OnboardingSeen {
    try {
        $folder = Split-Path -Parent $script:onboardingPath
        if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
        [IO.File]::WriteAllText($script:onboardingPath, '{"seen":true}', (New-Object Text.UTF8Encoding($false)))
    } catch { }
}

function Test-McpAuthorizationValue($value) {
    if ($null -eq $value) { return $false }
    $text = [string]$value
    if ([string]::IsNullOrWhiteSpace($text)) { return $false }
    if ($text -match '\$\{[^}]+\}') { return $false }
    return $true
}

function Test-McpConfigured {
    try {
        $token = [Environment]::GetEnvironmentVariable('MCD_MCP_TOKEN')
        if (Test-McpAuthorizationValue $token) { return $true }
        $mcpPath = Join-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.workbuddy') 'mcp.json'
        if (-not (Test-Path -LiteralPath $mcpPath)) { return $false }
        $raw = [IO.File]::ReadAllText($mcpPath, [Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { return $false }
        $config = $raw | ConvertFrom-Json
        $server = $null
        if ($config.PSObject.Properties['mcpServers']) {
            $server = $config.mcpServers.PSObject.Properties['mcd-mcp'].Value
        }
        if (-not $server -and $config.PSObject.Properties['mcd-mcp']) {
            $server = $config.PSObject.Properties['mcd-mcp'].Value
        }
        if (-not $server) { return $false }
        $authorization = $null
        if ($server.PSObject.Properties['headers']) {
            $authorization = $server.headers.PSObject.Properties['Authorization'].Value
        }
        if (-not $authorization -and $server.PSObject.Properties['Authorization']) {
            $authorization = $server.PSObject.Properties['Authorization'].Value
        }
        return (Test-McpAuthorizationValue $authorization)
    } catch { return $false }
}

function Test-JevConfigured {
    try {
        $keyPath = Join-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.jevmodel') 'api_key.txt'
        if (-not (Test-Path -LiteralPath $keyPath)) { return $false }
        return ((Get-Item -LiteralPath $keyPath -ErrorAction Stop).Length -gt 0)
    } catch { return $false }
}

function Open-OnboardingUrl($url) {
    try { Start-Process -FilePath $url | Out-Null } catch { Show-Tip '链接打开失败，请复制网址到浏览器' }
}

function Close-Onboarding {
    if (-not $script:onboardingWindow) { $state.Hover = $false; return }
    if ($script:onboardingClosing) { return }
    $script:onboardingClosing = $true
    $onb = $script:onboardingWindow
    $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $fade.To = 0.0
    $fade.Duration = New-Object System.Windows.Duration -ArgumentList ([TimeSpan]::FromMilliseconds(150))
    $slide = New-Object System.Windows.Media.Animation.DoubleAnimation
    $slide.To = -24.0
    $slide.Duration = $fade.Duration
    $fade.Add_Completed({ if ($script:onboardingWindow) { $script:onboardingWindow.Close() } })
    $onb.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
    if ($script:onboarding.ContainsKey('panel') -and $script:onboarding.panel.RenderTransform) {
        ([System.Windows.Media.TranslateTransform]$script:onboarding.panel.RenderTransform).BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $slide)
    }
}

function Start-MealFromOnboarding {
    $copied = Copy-Prompt
    $opened = Open-WorkBuddy
    if (-not $copied) { Show-Tip '复制失败，请右键重试' }
    elseif (-not $opened) { Show-Tip '已复制，但没找到 WorkBuddy' }
    else { Show-Tip '已复制，去 WorkBuddy 按 Ctrl+V' }
    Close-Onboarding
}

function Check-OnboardingKeys {
    if (-not $script:onboarding.ContainsKey('status')) { return }
    $mcpOk = Test-McpConfigured
    $jevOk = Test-JevConfigured
    if ($mcpOk -and $jevOk) {
        $script:onboarding.status.Text = '万事俱备，开始麦起来吧！'
        $script:onboarding.status.Foreground = Get-Brush '#1B7F4B'
        $script:onboarding.check.Visibility = 'Collapsed'
        $script:onboarding.start.Visibility = 'Visible'
        $state.ClickStep = 0
        $state.HeartStep = 0
        $state.SuccessTicks = 25
        Show-Tip '万事俱备，开始麦起来吧！'
        return
    }
    $missing = @()
    if (-not $mcpOk) { $missing += 'MCP Token' }
    if (-not $jevOk) { $missing += 'JEV Key' }
    $script:onboarding.status.Text = '还缺：' + ($missing -join '、') + '。完成后再点“我配好了，检查一下”。'
    $script:onboarding.status.Foreground = Get-Brush '#A33A20'
}

function Show-Onboarding {
    Set-OnboardingSeen
    if ($script:onboardingWindow -and $script:onboardingWindow.IsVisible) {
        $script:onboardingWindow.Activate()
        return
    }
    $state.Hover = $true
    $state.TapStep = 0
    Show-Tip '第一次用？我带你 3 步搞定。'
    $panel = New-Object System.Windows.Controls.StackPanel
    $panel.Margin = [System.Windows.Thickness]::new(18)
    $panel.Background = Get-Brush '#FFF4DE'
    $panel.RenderTransform = New-Object System.Windows.Media.TranslateTransform -ArgumentList (-24, 0)

    $title = New-Object System.Windows.Controls.TextBlock
    $title.Text = '第一次用？我带你 3 步搞定。'
    $title.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
    $title.FontSize = 19; $title.FontWeight = 'Bold'; $title.Foreground = Get-Brush '#3A2018'
    $title.Margin = [System.Windows.Thickness]::new(0, 0, 0, 10)
    [void]$panel.Children.Add($title)

    $intro = New-Object System.Windows.Controls.TextBlock
    $intro.Text = '跟着做一次，之后点小简就能开始点餐。'
    $intro.FontSize = 13; $intro.Foreground = Get-Brush '#6F5145'; $intro.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
    [void]$panel.Children.Add($intro)

    $step1 = New-Object System.Windows.Controls.StackPanel
    $step1.Orientation = 'Horizontal'; $step1.Margin = [System.Windows.Thickness]::new(0, 4, 0, 4)
    $s1 = New-Object System.Windows.Controls.TextBlock
    $s1.Text = '第 1 步：领麦当劳 MCP Token'; $s1.Width = 245; $s1.VerticalAlignment = 'Center'; $s1.FontSize = 14
    $b1 = New-Object System.Windows.Controls.Button
    $b1.Content = '去领 MCP'; $b1.Padding = [System.Windows.Thickness]::new(8, 3, 8, 3)
    $b1.Add_Click({ Open-OnboardingUrl 'https://open.mcd.cn/mcp' })
    [void]$step1.Children.Add($s1); [void]$step1.Children.Add($b1); [void]$panel.Children.Add($step1)

    $step2 = New-Object System.Windows.Controls.StackPanel
    $step2.Orientation = 'Horizontal'; $step2.Margin = [System.Windows.Thickness]::new(0, 4, 0, 4)
    $s2 = New-Object System.Windows.Controls.TextBlock
    $s2.Text = '第 2 步：注册 JEV + 配 Key'; $s2.Width = 245; $s2.VerticalAlignment = 'Center'; $s2.FontSize = 14
    $b2 = New-Object System.Windows.Controls.Button
    $b2.Content = '去注册 JEV'; $b2.Padding = [System.Windows.Thickness]::new(8, 3, 8, 3)
    $b2.Add_Click({ Open-OnboardingUrl 'https://jevmodel.org/zh/dashboard/' })
    [void]$step2.Children.Add($s2); [void]$step2.Children.Add($b2); [void]$panel.Children.Add($step2)

    $step3 = New-Object System.Windows.Controls.StackPanel
    $step3.Orientation = 'Horizontal'; $step3.Margin = [System.Windows.Thickness]::new(0, 8, 0, 4)
    $check = New-Object System.Windows.Controls.Button
    $check.Content = '我配好了，检查一下'; $check.Padding = [System.Windows.Thickness]::new(10, 5, 10, 5); $check.HorizontalAlignment = 'Left'
    [void]$step3.Children.Add($check); [void]$panel.Children.Add($step3)

    $status = New-Object System.Windows.Controls.TextBlock
    $status.Text = '只检查本机配置，不会上传 Token 或 Key。'; $status.TextWrapping = 'Wrap'; $status.FontSize = 12
    $status.Margin = [System.Windows.Thickness]::new(0, 8, 0, 8); $status.Foreground = Get-Brush '#6F5145'
    [void]$panel.Children.Add($status)

    $buttons = New-Object System.Windows.Controls.StackPanel
    $buttons.Orientation = 'Horizontal'; $buttons.HorizontalAlignment = 'Right'
    $skip = New-Object System.Windows.Controls.Button
    $skip.Content = '跳过教程'; $skip.Padding = [System.Windows.Thickness]::new(10, 4, 10, 4); $skip.Margin = [System.Windows.Thickness]::new(0, 0, 8, 0)
    $start = New-Object System.Windows.Controls.Button
    $start.Content = '开始点餐'; $start.Padding = [System.Windows.Thickness]::new(12, 4, 12, 4); $start.Visibility = 'Collapsed'
    [void]$buttons.Children.Add($skip); [void]$buttons.Children.Add($start); [void]$panel.Children.Add($buttons)

    $onb = New-Object System.Windows.Window
    $onb.Title = '小简新手教程'; $onb.Width = 430; $onb.Height = 330
    $onb.WindowStartupLocation = 'Manual'; $onb.ResizeMode = 'NoResize'; $onb.Topmost = $true; $onb.ShowInTaskbar = $false
    $onb.Background = Get-Brush '#FFF4DE'; $onb.Content = $panel
    $onb.Left = [Math]::Max($workArea.Left + 10, $window.Left - (($onb.Width - $window.Width) / 2)); $onb.Top = [Math]::Max($workArea.Top + 10, $window.Top - $onb.Height - 10)
    $onb.Opacity = 0.0
    $script:onboardingWindow = $onb
    $script:onboarding = @{ status = $status; check = $check; start = $start; panel = $panel }
    $check.Add_Click({ Check-OnboardingKeys })
    $skip.Add_Click({ Close-Onboarding })
    $start.Add_Click({ Start-MealFromOnboarding })
    $onb.Add_Closed({ $state.Hover = $false; $script:onboardingWindow = $null; $script:onboarding = @{}; $script:onboardingClosing = $false })
    $onb.Show() | Out-Null

    $ease = New-Object System.Windows.Media.Animation.CubicEase
    $ease.EasingMode = 'EaseOut'
    $duration = New-Object System.Windows.Duration -ArgumentList ([TimeSpan]::FromMilliseconds(220))
    $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $fade.To = 1.0; $fade.Duration = $duration; $fade.EasingFunction = $ease
    $slide = New-Object System.Windows.Media.Animation.DoubleAnimation
    $slide.To = 0.0; $slide.Duration = $duration; $slide.EasingFunction = $ease
    $onb.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
    ([System.Windows.Media.TranslateTransform]$panel.RenderTransform).BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $slide)
}

function Invoke-PetClick {
    $state.ClickStep = 0
    $state.HeartStep = 0
    $copied = Copy-Prompt
    $opened = Open-WorkBuddy
    if (-not $copied) { Show-Tip '复制失败，请右键重试' }
    elseif (-not $opened) { Show-Tip '已复制，但没找到 WorkBuddy' }
    else { Show-Tip '已复制，去 WorkBuddy 按 Ctrl+V' }
}

$script:press = @{ Active = $false; Start = [System.Windows.Point]::new(0, 0) }
$window.Add_MouseLeftButtonDown({
    param($sender, $e)
    $script:press = @{ Active = $true; Start = $e.GetPosition($window) }
})
$window.Add_MouseMove({
    param($sender, $e)
    if ($script:press.Active -and $e.LeftButton -eq 'Pressed') {
        $pos = $e.GetPosition($window)
        if ([Math]::Abs($pos.X - $script:press.Start.X) -gt 4 -or [Math]::Abs($pos.Y - $script:press.Start.Y) -gt 4) {
            $script:press.Active = $false
            $state.Dragging = $true
            try { $window.DragMove() } finally { $state.Dragging = $false }
        }
    }
})
$window.Add_MouseLeftButtonUp({
    param($sender, $e)
    if ($script:press.Active) {
        $script:press.Active = $false
        Invoke-PetClick
    }
})
$layout.Add_MouseEnter({ $state.Hover = $true })
$layout.Add_MouseLeave({ $state.Hover = $false })

function New-MenuItem($header, $action) {
    $item = New-Object System.Windows.Controls.MenuItem
    $item.Header = $header
    $item.Add_Click($action)
    $item
}

$menu = New-Object System.Windows.Controls.ContextMenu
[void]$menu.Items.Add((New-MenuItem '打开 WorkBuddy' { [void](Open-WorkBuddy) }))
[void]$menu.Items.Add((New-MenuItem '复制启动语' {
    if (Copy-Prompt) { Show-Tip '已复制，去 WorkBuddy 按 Ctrl+V' } else { Show-Tip '复制失败，请重试' }
}))
[void]$menu.Items.Add((New-MenuItem '打开项目目录' {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $cfg.projectPath + '"')
}))
[void]$menu.Items.Add((New-MenuItem '新手教程' { Show-Onboarding }))
[void]$menu.Items.Add((New-Object System.Windows.Controls.Separator))
[void]$menu.Items.Add((New-MenuItem '退出' { $window.Close() }))
$layout.ContextMenu = $menu

$frameTimer = New-Object System.Windows.Threading.DispatcherTimer
$frameTimer.Interval = [TimeSpan]::FromMilliseconds(60)
$frameTimer.Add_Tick({ Update-Pet })
$window.Add_Closed({ $frameTimer.Stop() })

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\SimpleEatPet', [ref]$createdNew)
if (-not $createdNew) { exit 0 }

try {
    $frameTimer.Start()
    $window.Add_ContentRendered({ if (-not (Get-OnboardingSeen)) { Show-Onboarding } })
    [void]$window.ShowDialog()
} catch {
    [void][System.Windows.MessageBox]::Show($_.Exception.Message, '小简')
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}