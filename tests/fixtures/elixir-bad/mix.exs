defmodule Bad.MixProject do
  use Mix.Project

  def project do
    [app: :bad, version: "0.1.0", deps: deps()]
  end

  defp deps do
    [
      {:open, ">= 3.0.0"},
      {:forked, git: "https://github.com/foo/forked.git", branch: "main"}
    ]
  end
end
