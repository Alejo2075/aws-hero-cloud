var app = WebApplication.CreateBuilder(args).Build();
app.MapGet("/", () => "hello from .NET");
app.Run();
