// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "App",
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.0.0"),
        .package(url: "https://github.com/vapor/vapor.git", exact: "4.89.0"),
        .package(
            url: "https://github.com/foo/pinned.git",
            revision: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
        ),
    ]
)
