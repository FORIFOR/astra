// 録音 Workspace の外枠（上辺中央に Task Dock の凹み）。
// macOS の RecordingWorkspaceShape と同じ制御点を使い、形状をほぼ同一にする。
// 値は shared/design/tokens.json 由来の GeneratedMetrics.cs（Astra.Metrics）。
//
// 状態: 未ビルド（この機では WinUI をビルドできない）。API 形は Windows App SDK 前提の下書き。
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;

namespace Astra;

public static class RecordingWorkspaceGeometry
{
    public static PathGeometry Build(double width, double height)
    {
        double r = Metrics.WorkspaceRadius;
        double cx = width / 2.0;
        double notchL = cx - Metrics.NotchWidth / 2.0;
        double notchR = cx + Metrics.NotchWidth / 2.0;
        double depth = Metrics.NotchDepth;
        double shoulder = Metrics.NotchShoulder;

        var figure = new PathFigure { StartPoint = new Point(r, 0), IsClosed = true };

        figure.Segments.Add(new LineSegment { Point = new Point(notchL - shoulder, 0) });
        // 左肩 → 凹み底（macOS と同じ制御点）
        figure.Segments.Add(new BezierSegment
        {
            Point1 = new Point(notchL - 14, 0),
            Point2 = new Point(notchL - 15, depth),
            Point3 = new Point(notchL, depth),
        });
        figure.Segments.Add(new LineSegment { Point = new Point(notchR, depth) });
        // 凹み → 右肩
        figure.Segments.Add(new BezierSegment
        {
            Point1 = new Point(notchR + 15, depth),
            Point2 = new Point(notchR + 14, 0),
            Point3 = new Point(notchR + shoulder, 0),
        });
        figure.Segments.Add(new LineSegment { Point = new Point(width - r, 0) });
        figure.Segments.Add(new QuadraticBezierSegment { Point1 = new Point(width, 0), Point2 = new Point(width, r) });
        figure.Segments.Add(new LineSegment { Point = new Point(width, height - r) });
        figure.Segments.Add(new QuadraticBezierSegment { Point1 = new Point(width, height), Point2 = new Point(width - r, height) });
        figure.Segments.Add(new LineSegment { Point = new Point(r, height) });
        figure.Segments.Add(new QuadraticBezierSegment { Point1 = new Point(0, height), Point2 = new Point(0, height - r) });
        figure.Segments.Add(new LineSegment { Point = new Point(0, r) });
        figure.Segments.Add(new QuadraticBezierSegment { Point1 = new Point(0, 0), Point2 = new Point(r, 0) });

        var geometry = new PathGeometry();
        geometry.Figures.Add(figure);
        return geometry;
    }
}
