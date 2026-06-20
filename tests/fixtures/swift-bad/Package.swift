// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Bad",
    dependencies: [
        .package(url: "https://github.com/foo/moving.git", branch: "main"),
    ]
)
